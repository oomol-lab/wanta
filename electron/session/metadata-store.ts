import type { SessionScope } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface SessionMetadata {
  title?: string
  scope?: SessionScope
  projectId?: string
  pinnedAt?: number
  archivedAt?: number
  deletedAt?: number
}

export interface PersistedSessionMetadata {
  version?: number
  sessions?: Record<string, SessionMetadata>
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function normalizeScope(value: unknown): SessionScope | undefined {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return undefined
  }
  const source = value as Partial<SessionScope>
  if (source.type === "personal") {
    return { type: "personal" }
  }
  if (source.type !== "organization") {
    return undefined
  }
  const rawOrganizationId = "organizationId" in source ? source.organizationId : undefined
  const rawOrganizationName = "organizationName" in source ? source.organizationName : undefined
  const organizationId = typeof rawOrganizationId === "string" ? rawOrganizationId.trim() : undefined
  const organizationName = typeof rawOrganizationName === "string" ? rawOrganizationName.trim() : undefined
  if (!organizationId || !organizationName) {
    return undefined
  }
  return { type: "organization", organizationId, organizationName }
}

function normalizeMetadata(value: unknown): Map<string, SessionMetadata> {
  const record = value && typeof value === "object" ? (value as PersistedSessionMetadata).sessions : undefined
  const metadata = new Map<string, SessionMetadata>()
  if (!record || typeof record !== "object") {
    return metadata
  }

  for (const [id, entry] of Object.entries(record)) {
    if (!id || !entry || typeof entry !== "object") {
      continue
    }
    const source = entry as SessionMetadata
    const next: SessionMetadata = {}
    if (typeof source.title === "string" && source.title.trim()) {
      next.title = source.title.trim()
    }
    const scope = normalizeScope(source.scope)
    if (scope) {
      next.scope = scope
    }
    if (typeof source.projectId === "string" && source.projectId.trim()) {
      next.projectId = source.projectId.trim()
    }
    if (validTimestamp(source.pinnedAt)) {
      next.pinnedAt = source.pinnedAt
    }
    if (validTimestamp(source.archivedAt)) {
      next.archivedAt = source.archivedAt
    }
    if (validTimestamp(source.deletedAt)) {
      next.deletedAt = source.deletedAt
    }
    if (next.title || next.scope || next.projectId || next.pinnedAt || next.archivedAt || next.deletedAt) {
      metadata.set(id, next)
    }
  }
  return metadata
}

function serializeMetadata(metadata: Map<string, SessionMetadata>): PersistedSessionMetadata {
  const sessions: Record<string, SessionMetadata> = {}
  for (const [id, entry] of metadata.entries()) {
    if (!id) {
      continue
    }
    const next: SessionMetadata = {}
    if (typeof entry.title === "string" && entry.title.trim()) {
      next.title = entry.title.trim()
    }
    const scope = normalizeScope(entry.scope)
    if (scope) {
      next.scope = scope
    }
    if (typeof entry.projectId === "string" && entry.projectId.trim()) {
      next.projectId = entry.projectId.trim()
    }
    if (validTimestamp(entry.pinnedAt)) {
      next.pinnedAt = entry.pinnedAt
    }
    if (validTimestamp(entry.archivedAt)) {
      next.archivedAt = entry.archivedAt
    }
    if (validTimestamp(entry.deletedAt)) {
      next.deletedAt = entry.deletedAt
    }
    if (next.title || next.scope || next.projectId || next.pinnedAt || next.archivedAt || next.deletedAt) {
      sessions[id] = next
    }
  }
  return { version: 3, sessions }
}

/** 会话展示元数据：置顶和归档属于 Wanta 侧边栏状态，不修改 OpenCode 会话本体。 */
export class SessionMetadataStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "session-metadata.json")
  }

  public async read(): Promise<Map<string, SessionMetadata>> {
    try {
      return normalizeMetadata(JSON.parse(await readFile(this.file, "utf-8")))
    } catch {
      return new Map()
    }
  }

  public async write(metadata: Map<string, SessionMetadata>): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeMetadata(metadata), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
}
