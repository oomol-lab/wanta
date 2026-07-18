import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"

type DiagnosticLevel = "trace" | "info" | "warn" | "error"
type DiagnosticFields = Record<string, unknown>

const maxLogBytes = 2 * 1024 * 1024
const maxDiagnosticStateEntries = 500
const maxDiagnosticValueDepth = 8
const pinoLevels: Record<DiagnosticLevel, number> = {
  trace: 10,
  info: 30,
  warn: 40,
  error: 50,
}

let writeQueue = Promise.resolve()
let diagnosticsLogPath: string | undefined
let announcedDiagnosticsLogPath: string | undefined
const diagnosticStateByKey = new Map<string, { signature: string; unchangedCount: number }>()

export function configureDiagnosticsLog(filePath: string): void {
  if (diagnosticsLogPath !== filePath) {
    diagnosticStateByKey.clear()
  }
  diagnosticsLogPath = filePath
  if (announcedDiagnosticsLogPath === filePath) {
    return
  }
  announcedDiagnosticsLogPath = filePath
  console.info(`[wanta][diagnostics-log] writing diagnostics to ${filePath}`)
}

export async function flushDiagnosticsLog(): Promise<void> {
  await writeQueue
}

export function logDiagnostic(
  scope: string,
  message: string,
  fields: DiagnosticFields = {},
  level: DiagnosticLevel = "trace",
): void {
  writeDiagnostic(scope, message, fields, level)
}

export function logDiagnosticOnChange(
  changeKey: string,
  scope: string,
  message: string,
  fields: DiagnosticFields = {},
  level: DiagnosticLevel = "trace",
  signatureFields: DiagnosticFields = fields,
): void {
  if (!diagnosticsLogPath) {
    return
  }

  const normalizedFields = normalizeFields(fields)
  const signature = JSON.stringify({
    fields: normalizeFields(signatureFields),
    level,
    message,
    scope,
  })
  const previousState = diagnosticStateByKey.get(changeKey)

  if (previousState?.signature === signature) {
    previousState.unchangedCount += 1
    return
  }

  rememberDiagnosticState(changeKey, { signature, unchangedCount: 0 })
  writeDiagnosticWithRollback(
    changeKey,
    previousState,
    signature,
    scope,
    message,
    previousState && previousState.unchangedCount > 0
      ? { ...normalizedFields, unchangedCount: previousState.unchangedCount }
      : normalizedFields,
    level,
  )
}

function rememberDiagnosticState(changeKey: string, state: { signature: string; unchangedCount: number }): void {
  diagnosticStateByKey.delete(changeKey)

  while (diagnosticStateByKey.size >= maxDiagnosticStateEntries) {
    const oldestKey = diagnosticStateByKey.keys().next().value
    if (typeof oldestKey !== "string") {
      break
    }
    diagnosticStateByKey.delete(oldestKey)
  }

  diagnosticStateByKey.set(changeKey, state)
}

function writeDiagnosticWithRollback(
  changeKey: string,
  previousState: { signature: string; unchangedCount: number } | undefined,
  signature: string,
  scope: string,
  message: string,
  fields: DiagnosticFields = {},
  level: DiagnosticLevel = "trace",
): void {
  writeDiagnostic(scope, message, fields, level, () => {
    const currentState = diagnosticStateByKey.get(changeKey)
    if (currentState?.signature !== signature) {
      return
    }

    if (previousState) {
      rememberDiagnosticState(changeKey, previousState)
    } else {
      diagnosticStateByKey.delete(changeKey)
    }
  })
}

function writeDiagnostic(
  scope: string,
  message: string,
  fields: DiagnosticFields = {},
  level: DiagnosticLevel = "trace",
  onWriteFailure?: () => void,
): void {
  const logPath = diagnosticsLogPath

  if (!logPath) {
    return
  }

  const entry = {
    level: pinoLevels[level],
    time: Date.now(),
    msg: message,
    scope,
    fields: normalizeFields(fields),
  }

  writeQueue = writeQueue
    .then(async () => {
      await mkdir(path.dirname(logPath), { recursive: true })
      await rotateDiagnosticsLogIfNeeded(logPath)
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8")
    })
    .catch((error: unknown) => {
      onWriteFailure?.()
      console.warn("[wanta][diagnostics-log] failed to write diagnostics log", error)
    })
}

function normalizeFields(fields: DiagnosticFields): DiagnosticFields {
  const normalized: DiagnosticFields = {}
  const seen = new WeakSet<object>([fields])
  let keys: string[]

  try {
    keys = Object.keys(fields).sort((left, right) => left.localeCompare(right))
  } catch (error) {
    return { serializationError: describeNormalizationFailure(error) }
  }

  for (const key of keys) {
    try {
      normalized[key] = normalizeValue(fields[key], seen, 0)
    } catch (error) {
      normalized[key] = `[Unreadable: ${describeNormalizationFailure(error)}]`
    }
  }

  return normalized
}

function normalizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value
  }

  if (typeof value !== "object") {
    return String(value)
  }

  if (depth >= maxDiagnosticValueDepth) {
    return "[Max depth]"
  }

  if (seen.has(value)) {
    return "[Circular]"
  }

  seen.add(value)
  try {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause === undefined ? undefined : normalizeValue(value.cause, seen, depth + 1),
      }
    }

    if (Array.isArray(value)) {
      return value.map((item) => normalizeValue(item, seen, depth + 1))
    }

    const normalized: DiagnosticFields = {}
    let keys: string[]
    try {
      keys = Object.keys(value).sort((left, right) => left.localeCompare(right))
    } catch (error) {
      return `[Unserializable: ${describeNormalizationFailure(error)}]`
    }
    for (const key of keys) {
      try {
        normalized[key] = normalizeValue((value as DiagnosticFields)[key], seen, depth + 1)
      } catch (error) {
        normalized[key] = `[Unreadable: ${describeNormalizationFailure(error)}]`
      }
    }
    return normalized
  } catch (error) {
    return `[Unserializable: ${describeNormalizationFailure(error)}]`
  } finally {
    seen.delete(value)
  }
}

function describeNormalizationFailure(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return "unknown error"
  }
}

async function rotateDiagnosticsLogIfNeeded(logPath: string): Promise<void> {
  const currentSize = await readFileSize(logPath)

  if (currentSize < maxLogBytes) {
    return
  }

  const backupPath = `${logPath}.1`
  await rm(backupPath, { force: true })
  await rename(logPath, backupPath)
}

async function readFileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size
  } catch {
    return 0
  }
}
