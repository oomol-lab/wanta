import type { TurnFileDiffResult, TurnOutputFile, TurnOutputRecord, TurnOutputSummary } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface StoredTurnOutputFile extends TurnOutputFile {
  diff: TurnFileDiffResult
}

export interface StoredTurnOutputRecord extends Omit<TurnOutputRecord, "files"> {
  files: StoredTurnOutputFile[]
}

export type TurnOutputRecords = Map<string, Map<string, StoredTurnOutputRecord>>

interface PersistedTurnOutputs {
  sessions?: Record<string, Record<string, StoredTurnOutputRecord>>
  version?: number
}

function validString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeSummary(value: unknown): TurnOutputSummary {
  const source = value && typeof value === "object" ? (value as Partial<TurnOutputSummary>) : {}
  return {
    artifactCount: validNumber(source.artifactCount) ? source.artifactCount : 0,
    processFileCount: validNumber(source.processFileCount) ? source.processFileCount : 0,
    changedFileCount: validNumber(source.changedFileCount) ? source.changedFileCount : 0,
    additions: validNumber(source.additions) ? source.additions : 0,
    deletions: validNumber(source.deletions) ? source.deletions : 0,
  }
}

function normalizeFile(value: unknown): StoredTurnOutputFile | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const source = value as Partial<StoredTurnOutputFile>
  if (!validString(source.path) || !validString(source.name) || !validString(source.mime)) {
    return null
  }
  const role = source.role
  if (role !== "artifact" && role !== "process" && role !== "project_change") {
    return null
  }
  const changeKind = source.changeKind
  if (changeKind !== "added" && changeKind !== "modified" && changeKind !== "deleted") {
    return null
  }
  const diff = source.diff
  if (!diff || typeof diff !== "object" || !validString(diff.path) || !validString(diff.mime)) {
    return null
  }
  const kind = ["text", "binary", "missing", "too_large"].includes(diff.kind ?? "") ? diff.kind : "missing"
  return {
    path: source.path,
    name: source.name,
    role,
    changeKind,
    mime: source.mime,
    additions: validNumber(source.additions) ? source.additions : 0,
    deletions: validNumber(source.deletions) ? source.deletions : 0,
    ...(source.binary ? { binary: true } : {}),
    ...(validNumber(source.size) ? { size: source.size } : {}),
    ...(source.truncated ? { truncated: true } : {}),
    diff: {
      kind,
      path: diff.path,
      mime: diff.mime,
      additions: validNumber(diff.additions) ? diff.additions : 0,
      deletions: validNumber(diff.deletions) ? diff.deletions : 0,
      ...(validString(diff.patch) ? { patch: diff.patch } : {}),
      ...(diff.truncated ? { truncated: true } : {}),
    },
  }
}

function normalizeRecord(value: unknown): StoredTurnOutputRecord | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const source = value as Partial<StoredTurnOutputRecord>
  if (!validString(source.sessionId) || !validString(source.messageId)) {
    return null
  }
  const files = Array.isArray(source.files) ? source.files.map(normalizeFile).filter(Boolean) : []
  return {
    sessionId: source.sessionId,
    messageId: source.messageId,
    ...(validString(source.artifactRoot) ? { artifactRoot: source.artifactRoot } : {}),
    ...(validString(source.processRoot) ? { processRoot: source.processRoot } : {}),
    ...(validString(source.projectRoot) ? { projectRoot: source.projectRoot } : {}),
    createdAt: validNumber(source.createdAt) ? source.createdAt : Date.now(),
    ...(validNumber(source.completedAt) ? { completedAt: source.completedAt } : {}),
    files: files as StoredTurnOutputFile[],
    summary: normalizeSummary(source.summary),
  }
}

function normalizeRecords(value: unknown): TurnOutputRecords {
  const sessions = value && typeof value === "object" ? (value as PersistedTurnOutputs).sessions : undefined
  const records: TurnOutputRecords = new Map()
  if (!sessions || typeof sessions !== "object") {
    return records
  }
  for (const [sessionId, rawMessages] of Object.entries(sessions)) {
    if (!validString(sessionId) || !rawMessages || typeof rawMessages !== "object") {
      continue
    }
    const messages = new Map<string, StoredTurnOutputRecord>()
    for (const [messageId, rawRecord] of Object.entries(rawMessages)) {
      const record = normalizeRecord(rawRecord)
      if (record && record.sessionId === sessionId && record.messageId === messageId) {
        messages.set(messageId, record)
      }
    }
    if (messages.size > 0) {
      records.set(sessionId, messages)
    }
  }
  return records
}

function serializeRecords(records: TurnOutputRecords): PersistedTurnOutputs {
  const sessions: PersistedTurnOutputs["sessions"] = {}
  for (const [sessionId, messages] of records) {
    const serializedMessages: Record<string, StoredTurnOutputRecord> = {}
    for (const [messageId, record] of messages) {
      serializedMessages[messageId] = record
    }
    if (Object.keys(serializedMessages).length > 0) {
      sessions[sessionId] = serializedMessages
    }
  }
  return { version: 1, sessions }
}

export function publicTurnOutputRecord(record: StoredTurnOutputRecord): TurnOutputRecord {
  return {
    ...record,
    files: record.files.map(({ diff: _diff, ...file }) => file),
  }
}

export function recordTurnOutput(records: TurnOutputRecords, record: StoredTurnOutputRecord): void {
  const messages = records.get(record.sessionId) ?? new Map<string, StoredTurnOutputRecord>()
  messages.set(record.messageId, record)
  records.set(record.sessionId, messages)
}

export function removeTurnOutputsForSession(records: TurnOutputRecords, sessionId: string): boolean {
  return records.delete(sessionId)
}

export class TurnOutputStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "turn-outputs.json")
  }

  public async read(): Promise<TurnOutputRecords> {
    try {
      return normalizeRecords(JSON.parse(await readFile(this.file, "utf-8")))
    } catch {
      return new Map()
    }
  }

  public async write(records: TurnOutputRecords): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeRecords(records), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }

  public async removeSession(sessionId: string): Promise<void> {
    const records = await this.read()
    if (!removeTurnOutputsForSession(records, sessionId)) {
      return
    }
    await this.write(records)
  }
}
