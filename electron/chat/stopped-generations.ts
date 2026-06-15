import type { ChatMessage, ChatMessagePart } from "./common.ts"

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface StoppedMessageRecord {
  partIds: Set<string>
  stoppedAt: number
}

export type StoppedGenerations = Map<string, Map<string, StoppedMessageRecord>>

interface PersistedStoppedMessage {
  partIds?: string[]
  stoppedAt?: number
}

interface PersistedStoppedGenerations {
  sessions?: Record<string, Record<string, PersistedStoppedMessage>>
}

function validId(value: string): boolean {
  return value.trim().length > 0
}

function normalizePartIds(partIds: readonly string[]): Set<string> {
  return new Set(partIds.filter(validId))
}

function isCancellableToolPart(part: ChatMessagePart): boolean {
  return part.kind === "tool" && part.status !== "completed"
}

function normalizeStoppedGenerations(value: unknown): StoppedGenerations {
  const sessions = value && typeof value === "object" ? (value as PersistedStoppedGenerations).sessions : undefined
  const records: StoppedGenerations = new Map()
  if (!sessions || typeof sessions !== "object") {
    return records
  }
  for (const [sessionId, messages] of Object.entries(sessions)) {
    if (!validId(sessionId) || !messages || typeof messages !== "object") {
      continue
    }
    const sessionRecords = new Map<string, StoppedMessageRecord>()
    for (const [messageId, record] of Object.entries(messages)) {
      if (!validId(messageId) || !record || typeof record !== "object") {
        continue
      }
      const stoppedAt = Number(record.stoppedAt)
      if (!Number.isFinite(stoppedAt) || stoppedAt <= 0) {
        continue
      }
      sessionRecords.set(messageId, {
        partIds: normalizePartIds(Array.isArray(record.partIds) ? record.partIds : []),
        stoppedAt,
      })
    }
    if (sessionRecords.size > 0) {
      records.set(sessionId, sessionRecords)
    }
  }
  return records
}

function serializeStoppedGenerations(records: StoppedGenerations): PersistedStoppedGenerations {
  const sessions: PersistedStoppedGenerations["sessions"] = {}
  for (const [sessionId, messages] of records) {
    if (!validId(sessionId) || messages.size === 0) {
      continue
    }
    const serializedMessages: Record<string, PersistedStoppedMessage> = {}
    for (const [messageId, record] of messages) {
      if (!validId(messageId) || !Number.isFinite(record.stoppedAt) || record.stoppedAt <= 0) {
        continue
      }
      serializedMessages[messageId] = {
        partIds: [...record.partIds].filter(validId),
        stoppedAt: record.stoppedAt,
      }
    }
    if (Object.keys(serializedMessages).length > 0) {
      sessions[sessionId] = serializedMessages
    }
  }
  return { sessions }
}

export function recordStoppedGeneration(
  records: StoppedGenerations,
  sessionId: string,
  messageId: string,
  partIds: readonly string[],
  stoppedAt = Date.now(),
): boolean {
  if (!validId(sessionId) || !validId(messageId) || !Number.isFinite(stoppedAt) || stoppedAt <= 0) {
    return false
  }
  const sessionRecords = records.get(sessionId) ?? new Map<string, StoppedMessageRecord>()
  const existing = sessionRecords.get(messageId)
  const nextPartIds = normalizePartIds(partIds)
  if (!existing) {
    sessionRecords.set(messageId, { partIds: nextPartIds, stoppedAt })
    records.set(sessionId, sessionRecords)
    return true
  }
  let changed = false
  if (nextPartIds.size === 0 && existing.partIds.size > 0) {
    existing.partIds.clear()
    changed = true
  } else if (existing.partIds.size > 0) {
    for (const partId of nextPartIds) {
      if (!existing.partIds.has(partId)) {
        existing.partIds.add(partId)
        changed = true
      }
    }
  }
  if (stoppedAt > existing.stoppedAt) {
    existing.stoppedAt = stoppedAt
    changed = true
  }
  return changed
}

export function applyStoppedGenerations(
  messages: ChatMessage[],
  sessionRecords: Map<string, StoppedMessageRecord> | undefined,
): ChatMessage[] {
  if (!sessionRecords || sessionRecords.size === 0) {
    return messages
  }
  let changed = false
  const nextMessages = messages.map((message) => {
    const record = sessionRecords.get(message.id)
    if (!record) {
      return message
    }
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (!isCancellableToolPart(part) || part.cancelled === true) {
        return part
      }
      if (record.partIds.size > 0 && !record.partIds.has(part.partId)) {
        return part
      }
      changed = true
      partsChanged = true
      return { ...part, cancelled: true }
    })
    return partsChanged ? { ...message, parts } : message
  })
  return changed ? nextMessages : messages
}

/** 用户主动停止记录：OpenCode 历史里可能仍是 tool error，Lumo 用此 overlay 还原“已停止”语义。 */
export class StoppedGenerationStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "stopped-generations.json")
  }

  public async read(): Promise<StoppedGenerations> {
    try {
      return normalizeStoppedGenerations(JSON.parse(await readFile(this.file, "utf-8")))
    } catch {
      return new Map()
    }
  }

  public async write(records: StoppedGenerations): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    try {
      await writeFile(tmp, JSON.stringify(serializeStoppedGenerations(records), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
}
