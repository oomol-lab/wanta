import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic } from "./diagnostics-log.ts"

export type OperationHistoryStatus = "failed" | "succeeded"

export interface OperationHistoryCreateParams {
  args: string[]
  command: string
  durationMs: number
  ok: boolean
  owner: string
  stderr?: string
  stdout?: string
}

export interface OperationHistoryRecord {
  args: string[]
  command: string
  durationMs: number
  endedAt: string
  id: string
  owner: string
  startedAt: string
  status: OperationHistoryStatus
  stderr?: string
  stdout?: string
}

const maxRecords = 80
const maxOutputLength = 4000
let writeQueue = Promise.resolve()

export async function listOperationHistory(limit = 30, filePath?: string): Promise<OperationHistoryRecord[]> {
  const records = await readHistoryFile(filePath ?? (await historyPath()))
  return records.slice(0, Math.max(0, limit))
}

export async function recordOperationHistory(params: OperationHistoryCreateParams, filePath?: string): Promise<void> {
  const record = createOperationHistoryRecord(params)
  const targetPath = filePath ?? (await historyPath())

  writeQueue = writeQueue
    .then(async () => {
      const records = await readHistoryFile(targetPath)
      await writeHistoryFile(targetPath, [record, ...records].slice(0, maxRecords))
    })
    .catch((error: unknown) => {
      console.warn("[wanta] failed to record operation", error)
      logDiagnostic("operation-history", "failed to record operation", { error }, "warn")
    })

  await writeQueue
}

export function createOperationHistoryRecord(params: OperationHistoryCreateParams): OperationHistoryRecord {
  const startedAt = new Date(Date.now() - Math.max(0, params.durationMs)).toISOString()

  return {
    args: sanitizeArgs(params.args),
    command: params.command,
    durationMs: Math.round(params.durationMs),
    endedAt: new Date().toISOString(),
    id: randomUUID(),
    owner: params.owner,
    status: params.ok ? "succeeded" : "failed",
    stderr: truncateOutput(params.stderr),
    stdout: truncateOutput(params.stdout),
    startedAt,
  }
}

export function sanitizeArgs(args: string[]): string[] {
  const sensitiveFlags = new Set(["--session-token", "--api-key", "--token", "--password", "--secret"])

  return args.map((arg, index) => {
    const previous = args[index - 1]
    if (previous && sensitiveFlags.has(previous)) {
      return "<redacted>"
    }

    if (arg.includes("=")) {
      const [key] = arg.split("=", 1)
      if (sensitiveFlags.has(key)) {
        return `${key}=<redacted>`
      }
    }

    return arg
  })
}

export function truncateOutput(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  if (value.length <= maxOutputLength) {
    return value
  }

  return `${value.slice(0, maxOutputLength)}\n... truncated`
}

async function readHistoryFile(filePath: string): Promise<OperationHistoryRecord[]> {
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isOperationHistoryRecord)
  } catch {
    return []
  }
}

async function writeHistoryFile(targetPath: string, records: OperationHistoryRecord[]): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.tmp`
  await writeFile(temporaryPath, JSON.stringify(records, null, 2), "utf8")
  await rename(temporaryPath, targetPath)
}

async function historyPath(): Promise<string> {
  const { app } = await import("electron")
  return path.join(app.getPath("userData"), "operation-history", "oo-cli.json")
}

function isOperationHistoryRecord(value: unknown): value is OperationHistoryRecord {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Partial<OperationHistoryRecord>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.command === "string" &&
    Array.isArray(candidate.args) &&
    candidate.args.every((arg) => typeof arg === "string") &&
    typeof candidate.owner === "string" &&
    (candidate.status === "succeeded" || candidate.status === "failed") &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.endedAt === "string" &&
    typeof candidate.durationMs === "number"
  )
}
