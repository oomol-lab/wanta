import { readFile } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface UnreadAttentionEntry {
  createdAt: number
  teamId?: string
  runId: string
}

interface PersistedAttentionState {
  unreadSessions?: Record<string, UnreadAttentionEntry>
  version?: number
}

function validEntry(value: unknown): value is UnreadAttentionEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<UnreadAttentionEntry>
  return (
    typeof entry.runId === "string" &&
    entry.runId.length > 0 &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    entry.createdAt > 0
  )
}

function normalizedEntry(value: UnreadAttentionEntry & { organizationId?: unknown }): UnreadAttentionEntry {
  const rawTeamId = typeof value.teamId === "string" ? value.teamId : value.organizationId
  const teamId = typeof rawTeamId === "string" ? rawTeamId.trim() : undefined
  return {
    createdAt: value.createdAt,
    ...(teamId ? { teamId } : {}),
    runId: value.runId,
  }
}

export function normalizeAttentionState(value: unknown): Map<string, UnreadAttentionEntry> {
  const source = value && typeof value === "object" ? (value as PersistedAttentionState).unreadSessions : undefined
  const entries = new Map<string, UnreadAttentionEntry>()
  if (!source || typeof source !== "object") return entries
  for (const [sessionId, entry] of Object.entries(source)) {
    if (sessionId && validEntry(entry)) {
      entries.set(sessionId, normalizedEntry(entry))
    }
  }
  return entries
}

function serializeAttentionState(entries: Map<string, UnreadAttentionEntry>): PersistedAttentionState {
  return { unreadSessions: Object.fromEntries(entries), version: 1 }
}

/** 未读任务动态状态单独异步持久化，避免完成事件同步写 settings.json 阻塞主进程。 */
export class AttentionStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "attention.json")
  }

  public async read(): Promise<Map<string, UnreadAttentionEntry>> {
    try {
      return normalizeAttentionState(JSON.parse(await readFile(this.file, "utf-8")))
    } catch (error) {
      logStoreReadFailure("attention", this.file, error)
      return new Map()
    }
  }

  public async write(entries: Map<string, UnreadAttentionEntry>): Promise<void> {
    await atomicWriteText(this.file, JSON.stringify(serializeAttentionState(entries), null, 2))
  }
}
