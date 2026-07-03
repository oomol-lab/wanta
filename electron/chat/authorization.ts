import type { AuthorizationInfo, ChatMessage } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export type AuthorizationOverlays = Map<string, Map<string, Map<string, AuthorizationInfo>>>

interface PersistedAuthorizationOverlays {
  sessions?: Record<string, Record<string, Record<string, Partial<AuthorizationInfo>>>>
}

function validId(value: string): boolean {
  return value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function normalizeAuthorization(value: unknown): AuthorizationInfo | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const record = value as Partial<AuthorizationInfo>
  if (typeof record.service !== "string" || !validId(record.service)) {
    return null
  }
  return {
    service: record.service,
    displayName: optionalString(record.displayName) ?? record.service,
    action: optionalString(record.action),
    authUrl: optionalString(record.authUrl),
    errorCode: optionalString(record.errorCode),
    message: optionalString(record.message),
  }
}

function normalizeAuthorizationOverlays(value: unknown): AuthorizationOverlays {
  const sessions = value && typeof value === "object" ? (value as PersistedAuthorizationOverlays).sessions : undefined
  const records: AuthorizationOverlays = new Map()
  if (!sessions || typeof sessions !== "object") {
    return records
  }
  for (const [sessionId, messages] of Object.entries(sessions)) {
    if (!validId(sessionId) || !messages || typeof messages !== "object") {
      continue
    }
    const sessionRecords = new Map<string, Map<string, AuthorizationInfo>>()
    for (const [messageId, parts] of Object.entries(messages)) {
      if (!validId(messageId) || !parts || typeof parts !== "object") {
        continue
      }
      const messageRecords = new Map<string, AuthorizationInfo>()
      for (const [partId, authorization] of Object.entries(parts)) {
        const normalized = normalizeAuthorization(authorization)
        if (validId(partId) && normalized) {
          messageRecords.set(partId, normalized)
        }
      }
      if (messageRecords.size > 0) {
        sessionRecords.set(messageId, messageRecords)
      }
    }
    if (sessionRecords.size > 0) {
      records.set(sessionId, sessionRecords)
    }
  }
  return records
}

function serializeAuthorizationOverlays(records: AuthorizationOverlays): PersistedAuthorizationOverlays {
  const sessions: PersistedAuthorizationOverlays["sessions"] = {}
  for (const [sessionId, messages] of records) {
    if (!validId(sessionId) || messages.size === 0) {
      continue
    }
    const serializedMessages: Record<string, Record<string, Partial<AuthorizationInfo>>> = {}
    for (const [messageId, parts] of messages) {
      if (!validId(messageId) || parts.size === 0) {
        continue
      }
      const serializedParts: Record<string, Partial<AuthorizationInfo>> = {}
      for (const [partId, authorization] of parts) {
        if (!validId(partId) || !validId(authorization.service)) {
          continue
        }
        serializedParts[partId] = {
          service: authorization.service,
          displayName: authorization.displayName,
          ...(authorization.action ? { action: authorization.action } : {}),
          ...(authorization.authUrl ? { authUrl: authorization.authUrl } : {}),
          ...(authorization.errorCode ? { errorCode: authorization.errorCode } : {}),
          ...(authorization.message ? { message: authorization.message } : {}),
        }
      }
      if (Object.keys(serializedParts).length > 0) {
        serializedMessages[messageId] = serializedParts
      }
    }
    if (Object.keys(serializedMessages).length > 0) {
      sessions[sessionId] = serializedMessages
    }
  }
  return { sessions }
}

function sameAuthorization(left: AuthorizationInfo | undefined, right: AuthorizationInfo): boolean {
  return (
    left?.service === right.service &&
    left.displayName === right.displayName &&
    left.action === right.action &&
    left.authUrl === right.authUrl &&
    left.errorCode === right.errorCode &&
    left.message === right.message
  )
}

export function recordAuthorizationOverlay(
  records: AuthorizationOverlays,
  sessionId: string,
  messageId: string,
  partId: string,
  authorization: AuthorizationInfo,
): boolean {
  if (!validId(sessionId) || !validId(messageId) || !validId(partId) || !validId(authorization.service)) {
    return false
  }
  const sessionRecords = records.get(sessionId) ?? new Map<string, Map<string, AuthorizationInfo>>()
  const messageRecords = sessionRecords.get(messageId) ?? new Map<string, AuthorizationInfo>()
  if (sameAuthorization(messageRecords.get(partId), authorization)) {
    return false
  }
  messageRecords.set(partId, authorization)
  sessionRecords.set(messageId, messageRecords)
  records.set(sessionId, sessionRecords)
  return true
}

export function applyAuthorizationOverlays(
  messages: ChatMessage[],
  sessionRecords: Map<string, Map<string, AuthorizationInfo>> | undefined,
): ChatMessage[] {
  if (!sessionRecords || sessionRecords.size === 0) {
    return messages
  }
  let changed = false
  const nextMessages = messages.map((message) => {
    const messageRecords = sessionRecords.get(message.id)
    if (!messageRecords || messageRecords.size === 0) {
      return message
    }
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (part.kind !== "tool") {
        return part
      }
      const authorization = messageRecords.get(part.partId)
      if (!authorization || sameAuthorization(part.authorization, authorization)) {
        return part
      }
      changed = true
      partsChanged = true
      return { ...part, authorization }
    })
    return partsChanged ? { ...message, parts } : message
  })
  return changed ? nextMessages : messages
}

/** 授权按钮 overlay：OpenCode 历史可能丢失工具输出，Wanta 单独持久化授权 UI 所需字段。 */
export class AuthorizationOverlayStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "authorization-overlays.json")
  }

  public async read(): Promise<AuthorizationOverlays> {
    try {
      return normalizeAuthorizationOverlays(JSON.parse(await readFile(this.file, "utf-8")))
    } catch (error) {
      logStoreReadFailure("authorization overlays", this.file, error)
      return new Map()
    }
  }

  public async write(records: AuthorizationOverlays): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeAuthorizationOverlays(records), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
}
