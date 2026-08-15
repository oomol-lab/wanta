import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseExternalSessionIdentity } from "../agent/external/session-id.ts"
import { atomicWriteText } from "../atomic-file.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"

// External (BYOA) sessions have no server-side session list, so Wanta keeps
// their base records itself. Display metadata (scope, pin, archive, project)
// still lives in SessionMetadataStore exactly like OpenCode sessions — this
// store only replaces what agent.listSessions() provides for the kernel.

export interface ExternalSessionRecord {
  id: string
  /** Stable provider id; never rename it without an explicit routing alias/migration. */
  agentKind: string
  title: string
  createdAt: number
  updatedAt: number
}

interface PersistedExternalSessions {
  version?: number
  sessions?: Record<string, Omit<ExternalSessionRecord, "id">>
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function normalizeRecords(value: unknown): Map<string, ExternalSessionRecord> {
  const record = value && typeof value === "object" ? (value as PersistedExternalSessions).sessions : undefined
  const sessions = new Map<string, ExternalSessionRecord>()
  if (!record || typeof record !== "object") {
    return sessions
  }
  for (const [id, entry] of Object.entries(record)) {
    if (!id || !entry || typeof entry !== "object") {
      continue
    }
    const identity = parseExternalSessionIdentity(id)
    if (!identity) {
      continue
    }
    const source = entry as Partial<ExternalSessionRecord>
    const createdAt = validTimestamp(source.createdAt) ? source.createdAt : undefined
    if (!createdAt) {
      continue
    }
    sessions.set(id, {
      id,
      // v1 records encoded the provider only in the id. Keeping this a plain
      // string lets removed/renamed providers survive a read/write cycle.
      agentKind:
        typeof source.agentKind === "string" && source.agentKind.trim() ? source.agentKind.trim() : identity.kind,
      title: typeof source.title === "string" && source.title.trim() ? source.title : "New session",
      createdAt,
      updatedAt: validTimestamp(source.updatedAt) ? source.updatedAt : createdAt,
    })
  }
  return sessions
}

function serializeRecords(records: Map<string, ExternalSessionRecord>): PersistedExternalSessions {
  const sessions: Record<string, Omit<ExternalSessionRecord, "id">> = {}
  for (const [id, entry] of records.entries()) {
    const identity = parseExternalSessionIdentity(id)
    if (!id || !identity) {
      continue
    }
    sessions[id] = {
      agentKind: entry.agentKind || identity.kind,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }
  return { version: 2, sessions }
}

export class ExternalSessionStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "external-sessions.json")
  }

  public async read(): Promise<Map<string, ExternalSessionRecord>> {
    try {
      return normalizeRecords(JSON.parse(await readFile(this.file, "utf-8")))
    } catch (error) {
      logStoreReadFailure("external sessions", this.file, error)
      return new Map()
    }
  }

  public async write(records: Map<string, ExternalSessionRecord>): Promise<void> {
    await atomicWriteText(this.file, JSON.stringify(serializeRecords(records), null, 2))
  }
}
