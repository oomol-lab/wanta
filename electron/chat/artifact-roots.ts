import type { ChatMessage } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export type ArtifactRoots = Map<string, Map<string, string>>

interface PersistedArtifactRoots {
  sessions?: Record<string, Record<string, string>>
}

function validValue(value: string): boolean {
  return value.trim().length > 0
}

function normalizeArtifactRoots(value: unknown): ArtifactRoots {
  const sessions = value && typeof value === "object" ? (value as PersistedArtifactRoots).sessions : undefined
  const records: ArtifactRoots = new Map()
  if (!sessions || typeof sessions !== "object") {
    return records
  }
  for (const [sessionId, messages] of Object.entries(sessions)) {
    if (!validValue(sessionId) || !messages || typeof messages !== "object") {
      continue
    }
    const sessionRecords = new Map<string, string>()
    for (const [messageId, artifactRoot] of Object.entries(messages)) {
      if (validValue(messageId) && typeof artifactRoot === "string" && validValue(artifactRoot)) {
        sessionRecords.set(messageId, artifactRoot)
      }
    }
    if (sessionRecords.size > 0) {
      records.set(sessionId, sessionRecords)
    }
  }
  return records
}

function serializeArtifactRoots(records: ArtifactRoots): PersistedArtifactRoots {
  const sessions: PersistedArtifactRoots["sessions"] = {}
  for (const [sessionId, messages] of records) {
    if (!validValue(sessionId) || messages.size === 0) {
      continue
    }
    const serializedMessages: Record<string, string> = {}
    for (const [messageId, artifactRoot] of messages) {
      if (validValue(messageId) && validValue(artifactRoot)) {
        serializedMessages[messageId] = artifactRoot
      }
    }
    if (Object.keys(serializedMessages).length > 0) {
      sessions[sessionId] = serializedMessages
    }
  }
  return { sessions }
}

export function recordArtifactRoot(
  records: ArtifactRoots,
  sessionId: string,
  messageId: string,
  artifactRoot: string,
): boolean {
  if (!validValue(sessionId) || !validValue(messageId) || !validValue(artifactRoot)) {
    return false
  }
  const sessionRecords = records.get(sessionId) ?? new Map<string, string>()
  if (sessionRecords.get(messageId) === artifactRoot) {
    return false
  }
  sessionRecords.set(messageId, artifactRoot)
  records.set(sessionId, sessionRecords)
  return true
}

export function applyArtifactRoots(
  messages: ChatMessage[],
  sessionRecords: Map<string, string> | undefined,
): ChatMessage[] {
  if (!sessionRecords || sessionRecords.size === 0) {
    return messages
  }
  let changed = false
  const nextMessages = messages.map((message) => {
    if (message.role !== "assistant") {
      return message
    }
    const artifactRoot = sessionRecords.get(message.id)
    if (!artifactRoot || message.artifactRoot === artifactRoot) {
      return message
    }
    changed = true
    return { ...message, artifactRoot }
  })
  return changed ? nextMessages : messages
}

/** 制成品根目录 overlay：OpenCode 历史不保存本轮 artifactRoot，Wanta 需单独持久化。 */
export class ArtifactRootStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "artifact-roots.json")
  }

  public async read(): Promise<ArtifactRoots> {
    try {
      return normalizeArtifactRoots(JSON.parse(await readFile(this.file, "utf-8")))
    } catch {
      return new Map()
    }
  }

  public async write(records: ArtifactRoots): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeArtifactRoots(records), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
}
