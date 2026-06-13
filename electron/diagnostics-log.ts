import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"

type DiagnosticLevel = "trace" | "info" | "warn"
type DiagnosticFields = Record<string, unknown>

const maxLogBytes = 2 * 1024 * 1024
const maxDiagnosticStateEntries = 500
const pinoLevels: Record<DiagnosticLevel, number> = {
  trace: 10,
  info: 30,
  warn: 40,
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
  console.info(`[lumo][diagnostics-log] writing diagnostics to ${filePath}`)
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
      console.warn("[lumo][diagnostics-log] failed to write diagnostics log", error)
    })
}

function normalizeFields(fields: DiagnosticFields): DiagnosticFields {
  const normalized: DiagnosticFields = {}

  for (const [key, value] of Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))) {
    normalized[key] = normalizeValue(value)
  }

  return normalized
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  if (typeof value === "object") {
    const normalized: DiagnosticFields = {}
    for (const [key, item] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      normalized[key] = normalizeValue(item)
    }
    return normalized
  }

  return String(value)
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
