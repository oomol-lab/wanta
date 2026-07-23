import type { ChatAttachment, ChatMessage, ChatMessagePart } from "./common.ts"

import { chmod, lstat, readFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface StoredUserAttachmentRecord {
  attachments: ChatAttachment[]
  internalPaths: string[]
  messageId: string
  sessionId: string
  userText?: string
}

interface PersistedUserAttachmentRecords {
  version?: number
  sessions?: Record<string, Record<string, StoredUserAttachmentRecord>>
}

export type UserAttachmentRecords = Map<string, Map<string, StoredUserAttachmentRecord>>

interface UserAttachmentStoreOptions {
  removeManagedPath?: (target: string, options: { force: boolean; recursive?: boolean }) => Promise<void>
}

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
  if (
    (persisted?.version !== 1 && persisted?.version !== 2) ||
    !persisted.sessions ||
    typeof persisted.sessions !== "object"
  ) {
    return records
  }
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
        !candidate.internalPaths.every(validText) ||
        (candidate.userText !== undefined && typeof candidate.userText !== "string")
      ) {
        continue
      }
      sessionRecords.set(messageId, {
        attachments: candidate.attachments.map(publicAttachment),
        internalPaths: [...candidate.internalPaths],
        messageId,
        sessionId,
        ...(typeof candidate.userText === "string" ? { userText: candidate.userText } : {}),
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
  return { version: 2, sessions }
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
    const attachments: ChatMessagePart[] = record.attachments.map((attachment) => ({
      attachment,
      kind: "attachment",
      partId: `wanta-attachment-${attachment.id}`,
    }))
    if (record.userText !== undefined) {
      const existingUserTextPart = message.parts.find((part) => part.kind === "text" && part.text === record.userText)
      const userTextPart: ChatMessagePart[] = record.userText
        ? [
            existingUserTextPart ?? {
              kind: "text",
              partId: `wanta-user-text-${message.id}`,
              text: record.userText,
            },
          ]
        : []
      const otherParts = message.parts.filter((part) => part.kind !== "attachment" && part.kind !== "text")
      return { ...message, parts: [...attachments, ...userTextPart, ...otherParts] }
    }
    const legacyPublicParts = message.parts.filter(
      (part) =>
        part.kind !== "attachment" &&
        !(part.kind === "text" && isLegacyInternalAttachmentText(part.text ?? "", record)),
    )
    return { ...message, parts: [...attachments, ...legacyPublicParts] }
  })
}

const legacyAttachmentLimit = 20

function legacySizeLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "unknown size"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function isLegacyAttachmentReferenceText(text: string, record: StoredUserAttachmentRecord): boolean {
  const lines = text.split("\n")
  if (lines.length !== 5) return false
  const attachment = record.attachments.find(
    (candidate) =>
      lines[0] === `Attached local file: ${candidate.name}` &&
      lines[1] === `Path: ${candidate.path}` &&
      lines[2] ===
        `Media type: ${candidate.mime || "application/octet-stream"}; size: ${legacySizeLabel(candidate.size)}`,
  )
  if (
    !attachment ||
    !lines[3]?.startsWith("The file was not embedded in the model request because ") ||
    !lines[3].endsWith(".")
  ) {
    return false
  }
  const directPathInstruction =
    "Use an appropriate local tool or script against the exact path when the task requires its contents. Do not use the Read tool on an unsupported binary file."
  if (lines[4] === directPathInstruction) return true
  return record.internalPaths.some(
    (internalPath) =>
      lines[4] ===
      `A prepared copy exists at ${internalPath}, but it was not embedded. Use local tools against the original or prepared path as appropriate.`,
  )
}

function isLegacyInternalAttachmentText(text: string, record: StoredUserAttachmentRecord): boolean {
  if (isLegacyAttachmentReferenceText(text, record)) return true
  const omitted = record.attachments.length - legacyAttachmentLimit
  return (
    omitted > 0 &&
    text ===
      `${omitted} additional attachment${omitted === 1 ? " was" : "s were"} not embedded because the per-turn limit is ${legacyAttachmentLimit}. Ask the user to split the files across multiple turns if they are required.`
  )
}

export class UserAttachmentStore {
  private readonly file: string
  private readonly managedAgentRoot: string
  private readonly managedOriginalRoot: string
  private readonly removeManagedPath: NonNullable<UserAttachmentStoreOptions["removeManagedPath"]>
  private records: UserAttachmentRecords | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(dir: string, options: UserAttachmentStoreOptions = {}) {
    this.file = path.join(dir, "user-attachments.json")
    this.managedAgentRoot = path.resolve(dir, "attachments", "agent")
    this.managedOriginalRoot = path.resolve(dir, "attachments", "originals")
    this.removeManagedPath = options.removeManagedPath ?? rm
  }

  public async read(): Promise<UserAttachmentRecords> {
    await this.mutationQueue
    return cloneRecords(await this.loadRecords())
  }

  public async record(
    sessionId: string,
    messageId: string,
    attachments: readonly ChatAttachment[],
    userText?: string,
  ): Promise<void> {
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
        ...(userText === undefined ? {} : { userText }),
      })
      records.set(sessionId, sessionRecords)
      await this.persist(records)
      this.records = records
    })
  }

  public async removeSession(sessionId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = cloneRecords(await this.loadRecords())
      const removed = [...(records.get(sessionId)?.values() ?? [])]
      if (!records.delete(sessionId)) return
      const retainedPaths = new Set(
        [...records.values()]
          .flatMap((messages) => [...messages.values()])
          .flatMap((record) => [
            ...record.attachments.map((attachment) => path.resolve(attachment.path)),
            ...record.internalPaths.map((internalPath) => path.resolve(internalPath)),
          ]),
      )
      await this.removeUnreferencedManagedFiles(removed, retainedPaths)
      await this.persist(records)
      this.records = records
    })
  }

  /** 消息未提交时精确回滚附件记录；只删除未被其他消息继续引用的托管副本。 */
  public async removeMessage(sessionId: string, messageId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = cloneRecords(await this.loadRecords())
      const sessionRecords = records.get(sessionId)
      const removed = sessionRecords?.get(messageId)
      if (!sessionRecords || !removed) return
      sessionRecords.delete(messageId)
      if (sessionRecords.size === 0) records.delete(sessionId)
      const retainedPaths = new Set(
        [...records.values()]
          .flatMap((messages) => [...messages.values()])
          .flatMap((record) => [
            ...record.attachments.map((attachment) => path.resolve(attachment.path)),
            ...record.internalPaths.map((internalPath) => path.resolve(internalPath)),
          ]),
      )
      await this.persist(records)
      this.records = records
      await this.removeUnreferencedManagedFiles([removed], retainedPaths).catch((error: unknown) => {
        console.warn("[wanta] failed to clean rolled-back user attachments:", error)
        logDiagnostic(
          "chat-service",
          "failed to clean rolled-back user attachments",
          { error, messageId, sessionId },
          "warn",
        )
      })
    })
  }

  /** 清理已过保留期且不被任何已发送消息引用的草稿/中间附件。 */
  public async pruneExpiredUnreferenced(maxAgeMs = 7 * 24 * 60 * 60_000, now = Date.now()): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = await this.loadRecords()
      const referenced = new Set(
        [...records.values()]
          .flatMap((messages) => [...messages.values()])
          .flatMap((record) => [
            ...record.attachments.map((attachment) => path.resolve(attachment.path)),
            ...record.internalPaths.map((internalPath) => path.resolve(internalPath)),
          ]),
      )
      const referencedDirectories = new Set([...referenced].map((filePath) => path.dirname(filePath)))
      const cutoff = now - maxAgeMs
      const originalEntries = await readdir(this.managedOriginalRoot, { withFileTypes: true }).catch(() => [])
      for (const entry of originalEntries) {
        const directory = path.join(this.managedOriginalRoot, entry.name)
        if (!entry.isDirectory() || referencedDirectories.has(directory)) continue
        const info = await lstat(directory).catch(() => null)
        if (!info || info.mtimeMs > cutoff) continue
        await chmod(directory, 0o700).catch(() => undefined)
        await this.removeManagedPath(directory, { force: true, recursive: true })
      }
      for (const root of [this.managedAgentRoot, path.resolve(path.dirname(this.managedOriginalRoot), "clipboard")]) {
        const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          const filePath = path.join(root, entry.name)
          if (!entry.isFile() || referenced.has(filePath)) continue
          const info = await lstat(filePath).catch(() => null)
          if (info && info.mtimeMs <= cutoff) await this.removeManagedPath(filePath, { force: true })
        }
      }
    })
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
        await this.removeManagedPath(resolved, { force: true })
      }
    }
    for (const directory of directories) {
      await chmod(directory, 0o700).catch(() => undefined)
      await this.removeManagedPath(directory, { force: true, recursive: true })
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
    await atomicWriteText(this.file, JSON.stringify(serializeRecords(records), null, 2), { mode: 0o600 })
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
