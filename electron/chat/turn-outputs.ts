import type { ArtifactBundleStore } from "./artifact-bundles.ts"
import type { TurnFileDiffResult, TurnOutputFile, TurnOutputRecord, TurnOutputSummary } from "./common.ts"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"
import { buildArtifactBundle } from "./artifact-bundles.ts"

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
  if (role !== "process" && role !== "project_change") {
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

async function migrateLegacyArtifactBundles(
  value: unknown,
  artifactBundleStore: ArtifactBundleStore | undefined,
): Promise<{ complete: boolean; found: boolean }> {
  const sessions = value && typeof value === "object" ? (value as PersistedTurnOutputs).sessions : undefined
  if (!sessions || typeof sessions !== "object" || !artifactBundleStore) {
    return { complete: false, found: false }
  }
  let complete = true
  let found = false
  for (const rawMessages of Object.values(sessions)) {
    if (!rawMessages || typeof rawMessages !== "object") {
      continue
    }
    for (const rawRecord of Object.values(rawMessages)) {
      if (!rawRecord || typeof rawRecord !== "object") {
        continue
      }
      const source = rawRecord as unknown as Record<string, unknown>
      const artifactRoot = validString(source["artifactRoot"]) ? source["artifactRoot"] : undefined
      const files = Array.isArray(source["files"]) ? source["files"] : []
      const hasLegacyArtifacts = files.some(
        (file) => file && typeof file === "object" && (file as { role?: unknown }).role === "artifact",
      )
      if (
        !artifactRoot ||
        !hasLegacyArtifacts ||
        !validString(source["sessionId"]) ||
        !validString(source["messageId"])
      ) {
        continue
      }
      found = true
      const bundle = await buildArtifactBundle({
        artifactRoot,
        completedAt: validNumber(source["completedAt"]) ? source["completedAt"] : Date.now(),
        createdAt: validNumber(source["createdAt"]) ? source["createdAt"] : Date.now(),
        generatedPreviewCount: 0,
        messageId: source["messageId"],
        sessionId: source["sessionId"],
      }).catch(() => null)
      if (!bundle) {
        complete = false
        continue
      }
      await artifactBundleStore.record(bundle).catch(() => {
        complete = false
      })
    }
  }
  return { complete, found }
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

function cloneTurnOutputRecords(records: TurnOutputRecords): TurnOutputRecords {
  return new Map([...records].map(([sessionId, messages]) => [sessionId, new Map(messages)]))
}

export class TurnOutputStore {
  private readonly artifactBundleStore: ArtifactBundleStore | undefined
  private readonly file: string
  private records: TurnOutputRecords | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(dir: string, artifactBundleStore?: ArtifactBundleStore) {
    this.artifactBundleStore = artifactBundleStore
    this.file = path.join(dir, "turn-outputs.json")
  }

  public async read(): Promise<TurnOutputRecords> {
    await this.mutationQueue
    return cloneTurnOutputRecords(await this.loadRecords())
  }

  private async loadRecords(): Promise<TurnOutputRecords> {
    if (this.records) {
      return this.records
    }
    let persisted: unknown
    try {
      persisted = JSON.parse(await readFile(this.file, "utf-8"))
    } catch (error) {
      logStoreReadFailure("turn outputs", this.file, error)
      this.records = new Map()
      return this.records
    }
    this.records = normalizeRecords(persisted)
    const migration = await migrateLegacyArtifactBundles(persisted, this.artifactBundleStore)
    if (migration.found && migration.complete) {
      await this.persist(this.records).catch((error: unknown) => {
        console.warn("[wanta] failed to finalize legacy artifact migration", error)
      })
    }
    return this.records
  }

  public async write(records: TurnOutputRecords): Promise<void> {
    const snapshot = cloneTurnOutputRecords(records)
    await this.enqueueMutation(async () => {
      await this.persist(snapshot)
      this.records = snapshot
    })
  }

  public async record(record: StoredTurnOutputRecord): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = cloneTurnOutputRecords(await this.loadRecords())
      recordTurnOutput(records, record)
      await this.persist(records)
      this.records = records
    })
  }

  public async removeSession(sessionId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = cloneTurnOutputRecords(await this.loadRecords())
      if (!removeTurnOutputsForSession(records, sessionId)) {
        return
      }
      await this.persist(records)
      this.records = records
    })
  }

  private async persist(records: TurnOutputRecords): Promise<void> {
    await atomicWriteText(this.file, JSON.stringify(serializeRecords(records), null, 2))
  }

  private async enqueueMutation(mutation: () => Promise<void>): Promise<void> {
    const operation = this.mutationQueue.catch(() => undefined).then(mutation)
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
  }
}
