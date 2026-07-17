import type { ChatAttachment, ChatMessage, ChatMessagePart } from "./common.ts"

import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface StoredUserAttachmentRecord {
  attachments: ChatAttachment[]
  internalPaths: string[]
  messageId: string
  sessionId: string
}

interface PersistedUserAttachmentRecords {
  version?: number
  sessions?: Record<string, Record<string, StoredUserAttachmentRecord>>
}

export type UserAttachmentRecords = Map<string, Map<string, StoredUserAttachmentRecord>>

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") return false
  const attachment = value as Partial<ChatAttachment>
  return (
    validText(attachment.id) &&
    validText(attachment.name) &&
    typeof attachment.mime === "string" &&
    typeof attachment.size === "number" &&
    Number.isFinite(attachment.size) &&
    attachment.size >= 0 &&
    validText(attachment.path) &&
    (attachment.kind === undefined || attachment.kind === "file" || attachment.kind === "directory")
  )
}

function publicAttachment(attachment: ChatAttachment): ChatAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    mime: attachment.mime,
    name: attachment.name,
    path: attachment.path,
    size: attachment.size,
  }
}

function normalizeRecords(value: unknown): UserAttachmentRecords {
  const persisted = value && typeof value === "object" ? (value as PersistedUserAttachmentRecords) : undefined
  const records: UserAttachmentRecords = new Map()
  if (persisted?.version !== 1 || !persisted.sessions || typeof persisted.sessions !== "object") return records
  for (const [sessionId, messages] of Object.entries(persisted.sessions)) {
    if (!validText(sessionId) || !messages || typeof messages !== "object") continue
    const sessionRecords = new Map<string, StoredUserAttachmentRecord>()
    for (const [messageId, candidate] of Object.entries(messages)) {
      if (
        !validText(messageId) ||
        !candidate ||
        typeof candidate !== "object" ||
        candidate.sessionId !== sessionId ||
        candidate.messageId !== messageId ||
        !Array.isArray(candidate.attachments) ||
        !candidate.attachments.every(validAttachment) ||
        !Array.isArray(candidate.internalPaths) ||
        !candidate.internalPaths.every(validText)
      ) {
        continue
      }
      sessionRecords.set(messageId, {
        attachments: candidate.attachments.map(publicAttachment),
        internalPaths: [...candidate.internalPaths],
        messageId,
        sessionId,
      })
    }
    if (sessionRecords.size > 0) records.set(sessionId, sessionRecords)
  }
  return records
}

function serializeRecords(records: UserAttachmentRecords): PersistedUserAttachmentRecords {
  const sessions: NonNullable<PersistedUserAttachmentRecords["sessions"]> = {}
  for (const [sessionId, messages] of records) {
    const serialized: Record<string, StoredUserAttachmentRecord> = {}
    for (const [messageId, record] of messages) serialized[messageId] = record
    if (Object.keys(serialized).length > 0) sessions[sessionId] = serialized
  }
  return { version: 1, sessions }
}

function cloneRecords(records: UserAttachmentRecords): UserAttachmentRecords {
  return new Map(
    [...records].map(([sessionId, messages]) => [
      sessionId,
      new Map(
        [...messages].map(([messageId, record]) => [
          messageId,
          {
            ...record,
            attachments: record.attachments.map(publicAttachment),
            internalPaths: [...record.internalPaths],
          },
        ]),
      ),
    ]),
  )
}

export function applyUserAttachmentRecords(
  messages: ChatMessage[],
  records: ReadonlyMap<string, StoredUserAttachmentRecord> | undefined,
): ChatMessage[] {
  if (!records?.size) return messages
  return messages.map((message) => {
    if (message.role !== "user") return message
    const record = records.get(message.id)
    if (!record) return message
    const nonAttachments = message.parts.filter((part) => part.kind !== "attachment")
    const attachments: ChatMessagePart[] = record.attachments.map((attachment) => ({
      attachment,
      kind: "attachment",
      partId: `wanta-attachment-${attachment.id}`,
    }))
    return { ...message, parts: [...attachments, ...nonAttachments] }
  })
}

export class UserAttachmentStore {
  private readonly file: string
  private readonly managedAgentRoot: string
  private readonly managedOriginalRoot: string
  private records: UserAttachmentRecords | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(dir: string) {
    this.file = path.join(dir, "user-attachments.json")
    this.managedAgentRoot = path.resolve(dir, "attachments", "agent")
    this.managedOriginalRoot = path.resolve(dir, "attachments", "originals")
  }

  public async read(): Promise<UserAttachmentRecords> {
    await this.mutationQueue
    return cloneRecords(await this.loadRecords())
  }

  public async record(sessionId: string, messageId: string, attachments: readonly ChatAttachment[]): Promise<void> {
    if (attachments.length === 0) return
    await this.enqueueMutation(async () => {
      const records = cloneRecords(await this.loadRecords())
      const sessionRecords = records.get(sessionId) ?? new Map<string, StoredUserAttachmentRecord>()
      sessionRecords.set(messageId, {
        attachments: attachments.map(publicAttachment),
        internalPaths: attachments
          .map((attachment) => attachment.agentPath?.trim())
          .filter((value): value is string => Boolean(value)),
        messageId,
        sessionId,
      })
      records.set(sessionId, sessionRecords)
      await this.persist(records)
      this.records = records
    })
  }

  public async removeSession(sessionId: string): Promise<void> {
    let removed: StoredUserAttachmentRecord[] = []
    let retainedPaths = new Set<string>()
    await this.enqueueMutation(async () => {
      const records = cloneRecords(await this.loadRecords())
      removed = [...(records.get(sessionId)?.values() ?? [])]
      if (!records.delete(sessionId)) return
      retainedPaths = new Set(
        [...records.values()]
          .flatMap((messages) => [...messages.values()])
          .flatMap((record) => [
            ...record.attachments.map((attachment) => path.resolve(attachment.path)),
            ...record.internalPaths.map((internalPath) => path.resolve(internalPath)),
          ]),
      )
      await this.persist(records)
      this.records = records
    })
    await this.removeUnreferencedManagedFiles(removed, retainedPaths)
  }

  private async removeUnreferencedManagedFiles(
    records: StoredUserAttachmentRecord[],
    retainedPaths: ReadonlySet<string>,
  ): Promise<void> {
    const files = new Set(
      records.flatMap((record) => [
        ...record.attachments.map((attachment) => attachment.path),
        ...record.internalPaths,
      ]),
    )
    const directories = new Set<string>()
    for (const candidate of files) {
      const resolved = path.resolve(candidate)
      if (retainedPaths.has(resolved)) continue
      const directory = path.dirname(resolved)
      if (path.dirname(directory) === this.managedOriginalRoot) {
        directories.add(directory)
      } else if (directory === this.managedAgentRoot) {
        await rm(resolved, { force: true })
      }
    }
    for (const directory of directories) {
      await chmod(directory, 0o700).catch(() => undefined)
      await rm(directory, { force: true, recursive: true })
    }
  }

  private async loadRecords(): Promise<UserAttachmentRecords> {
    if (this.records) return this.records
    try {
      this.records = normalizeRecords(JSON.parse(await readFile(this.file, "utf8")))
    } catch (error) {
      logStoreReadFailure("user attachments", this.file, error)
      this.records = new Map()
    }
    return this.records
  }

  private async persist(records: UserAttachmentRecords): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporaryPath = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temporaryPath, JSON.stringify(serializeRecords(records), null, 2), {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporaryPath, this.file)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
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
