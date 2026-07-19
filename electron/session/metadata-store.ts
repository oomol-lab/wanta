import type { SessionScope } from "./common.ts"
import type { SessionPermissionMode } from "./common.ts"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"
import { normalizeSessionScopeValue } from "./common.ts"

export interface SessionMetadata {
  scope?: SessionScope
  projectId?: string
  permissionMode?: SessionPermissionMode
  knowledgeBaseIds?: string[]
  pinnedAt?: number
  archivedAt?: number
}

export interface PersistedSessionMetadata {
  version?: number
  sessions?: Record<string, SessionMetadata>
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function normalizePermissionMode(value: unknown): SessionPermissionMode | undefined {
  return value === "full_access" || value === "default" ? value : undefined
}

export function normalizeKnowledgeBaseIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = [...new Set(value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])))]
  return ids.length > 0 ? ids : undefined
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
    const scope = normalizeSessionScopeValue(source.scope)
    if (scope) {
      next.scope = scope
    }
    if (typeof source.projectId === "string" && source.projectId.trim()) {
      next.projectId = source.projectId.trim()
    }
    const permissionMode = normalizePermissionMode(source.permissionMode)
    if (permissionMode) {
      next.permissionMode = permissionMode
    }
    const knowledgeBaseIds = normalizeKnowledgeBaseIds(source.knowledgeBaseIds)
    if (knowledgeBaseIds) next.knowledgeBaseIds = knowledgeBaseIds
    if (validTimestamp(source.pinnedAt)) {
      next.pinnedAt = source.pinnedAt
    }
    if (validTimestamp(source.archivedAt)) {
      next.archivedAt = source.archivedAt
    }
    if (
      next.scope ||
      next.projectId ||
      next.permissionMode ||
      next.knowledgeBaseIds ||
      next.pinnedAt ||
      next.archivedAt
    ) {
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
    const scope = normalizeSessionScopeValue(entry.scope)
    if (scope) {
      next.scope = scope
    }
    if (typeof entry.projectId === "string" && entry.projectId.trim()) {
      next.projectId = entry.projectId.trim()
    }
    const permissionMode = normalizePermissionMode(entry.permissionMode)
    if (permissionMode) {
      next.permissionMode = permissionMode
    }
    const knowledgeBaseIds = normalizeKnowledgeBaseIds(entry.knowledgeBaseIds)
    if (knowledgeBaseIds) next.knowledgeBaseIds = knowledgeBaseIds
    if (validTimestamp(entry.pinnedAt)) {
      next.pinnedAt = entry.pinnedAt
    }
    if (validTimestamp(entry.archivedAt)) {
      next.archivedAt = entry.archivedAt
    }
    if (
      next.scope ||
      next.projectId ||
      next.permissionMode ||
      next.knowledgeBaseIds ||
      next.pinnedAt ||
      next.archivedAt
    ) {
      sessions[id] = next
    }
  }
  return { version: 4, sessions }
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
    } catch (error) {
      logStoreReadFailure("session metadata", this.file, error)
      return new Map()
    }
  }

  public async write(metadata: Map<string, SessionMetadata>): Promise<void> {
    await atomicWriteText(this.file, JSON.stringify(serializeMetadata(metadata), null, 2))
  }
}
