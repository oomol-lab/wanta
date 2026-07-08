import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { QuestionDraftSnapshot, QuestionFieldDraft } from "./question-fields.ts"
import type { QuestionDismissal, QuestionPromptTarget } from "./question-model.ts"

import { questionPromptTargetRequestId, questionPromptTargetToolKey, questionRequestToolKey } from "./question-model.ts"
import { normalizeQuestionRequest } from "./question-request-normalization.ts"

const stoppedQuestionsStorageKey = "wanta:chat:stopped-questions:v1"
const recoverableQuestionsStorageKey = "wanta:chat:recoverable-questions:v1"
const questionDraftsStorageKey = "wanta:chat:question-drafts:v1"
const dismissedQuestionsStorageKey = "wanta:chat:dismissed-questions:v1"
const questionPromptsStorageKey = "wanta:chat:question-prompts:v2"
const questionPersistenceMaxAgeMs = 14 * 24 * 60 * 60 * 1000

type StoredQuestionPromptState = "stopped" | "recoverable" | "dismissed"

interface StoredQuestionDraft {
  activeFieldIndex: number
  drafts: QuestionFieldDraft[]
  updatedAt: number
}

interface StoredStoppedQuestion {
  request: ChatQuestionRequest
  updatedAt: number
}

interface StoredDismissedQuestion {
  requestId: string
  toolKey?: string
  updatedAt: number
}

interface StoredQuestionPrompt {
  draft?: StoredQuestionDraft
  request?: ChatQuestionRequest
  requestId: string
  state?: StoredQuestionPromptState
  toolKey?: string
  updatedAt: number
}

type StoredQuestionDraftsBySession = Record<string, Record<string, StoredQuestionDraft>>
type StoredStoppedQuestionsBySession = Record<string, Array<ChatQuestionRequest | StoredStoppedQuestion>>
type StoredDismissedQuestionsBySession = Record<string, StoredDismissedQuestion[]>
type StoredQuestionPromptsBySession = Record<string, StoredQuestionPrompt[]>

export type StoredQuestionDraftSnapshot = QuestionDraftSnapshot

export interface StoredQuestionPromptSnapshot {
  dismissedQuestions: QuestionDismissal[]
  recoverableQuestions: ChatQuestionRequest[]
  stoppedQuestions: ChatQuestionRequest[]
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readJson<T>(key: string, fallback: T): T {
  const storage = getLocalStorage()
  if (!storage) {
    return fallback
  }
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage 只是草稿恢复兜底，写失败不影响当前会话。
  }
}

function normalizeDraft(draft: QuestionFieldDraft | undefined): QuestionFieldDraft {
  return {
    selected: Array.isArray(draft?.selected) ? draft.selected.filter((item) => typeof item === "string") : [],
    value: typeof draft?.value === "string" ? draft.value : "",
  }
}

function isFresh(updatedAt: number | undefined, now = Date.now()): boolean {
  return typeof updatedAt === "number" && now - updatedAt <= questionPersistenceMaxAgeMs
}

function stoppedQuestionItemRequest(item: ChatQuestionRequest | StoredStoppedQuestion): ChatQuestionRequest {
  return "request" in item ? item.request : item
}

function stoppedQuestionItemUpdatedAt(item: ChatQuestionRequest | StoredStoppedQuestion): number | undefined {
  return "updatedAt" in item ? item.updatedAt : Date.now()
}

function dismissalStorageKey(dismissal: QuestionDismissal): string {
  // 优先按 tool key 去重，缺少 tool 信息的旧记录再退回 request id。
  return dismissal.toolKey ? `tool:${dismissal.toolKey}` : `id:${dismissal.requestId}`
}

function questionDismissal(request: ChatQuestionRequest): QuestionDismissal {
  // dismissed 只保存最小匹配信息，不持久化完整问题内容，避免覆盖 stopped/recoverable 快照。
  return {
    requestId: request.id,
    toolKey: questionRequestToolKey(request),
  }
}

function pruneStoppedQuestions(
  stored: StoredStoppedQuestionsBySession,
  now = Date.now(),
): StoredStoppedQuestionsBySession {
  let changed = false
  const next: StoredStoppedQuestionsBySession = {}
  for (const [sessionId, items] of Object.entries(stored)) {
    const freshItems = items.filter((item) => isFresh(stoppedQuestionItemUpdatedAt(item), now))
    if (freshItems.length !== items.length) {
      changed = true
    }
    if (freshItems.length > 0) {
      next[sessionId] = freshItems
    } else if (items.length > 0) {
      changed = true
    }
  }
  return changed ? next : stored
}

function pruneQuestionDrafts(stored: StoredQuestionDraftsBySession, now = Date.now()): StoredQuestionDraftsBySession {
  let changed = false
  const next: StoredQuestionDraftsBySession = {}
  for (const [sessionId, draftsByRequest] of Object.entries(stored)) {
    const freshEntries = Object.entries(draftsByRequest).filter(([, item]) => isFresh(item.updatedAt, now))
    if (freshEntries.length !== Object.keys(draftsByRequest).length) {
      changed = true
    }
    if (freshEntries.length > 0) {
      next[sessionId] = Object.fromEntries(freshEntries)
    } else if (Object.keys(draftsByRequest).length > 0) {
      changed = true
    }
  }
  return changed ? next : stored
}

function normalizeStoredDismissedQuestion(value: unknown): StoredDismissedQuestion | null {
  // dismissed 记录只保留 14 天，避免长期屏蔽同一会话里后续重新提出的问题。
  if (!value || typeof value !== "object") {
    return null
  }
  const item = value as { requestId?: unknown; toolKey?: unknown; updatedAt?: unknown }
  if (typeof item.requestId !== "string" || typeof item.updatedAt !== "number" || !isFresh(item.updatedAt)) {
    return null
  }
  return {
    requestId: item.requestId,
    ...(typeof item.toolKey === "string" && item.toolKey ? { toolKey: item.toolKey } : {}),
    updatedAt: item.updatedAt,
  }
}

function pruneDismissedQuestions(
  stored: StoredDismissedQuestionsBySession,
  now = Date.now(),
): StoredDismissedQuestionsBySession {
  // 读取/写入前顺手裁剪过期 dismissed，保持 localStorage 体积和 stopped/recoverable 一致受控。
  let changed = false
  const next: StoredDismissedQuestionsBySession = {}
  for (const [sessionId, items] of Object.entries(stored)) {
    const freshItems = Array.isArray(items)
      ? items.filter((item) => typeof item.updatedAt === "number" && isFresh(item.updatedAt, now))
      : []
    if (freshItems.length !== items.length) {
      changed = true
    }
    if (freshItems.length > 0) {
      next[sessionId] = freshItems
    } else if (items.length > 0) {
      changed = true
    }
  }
  return changed ? next : stored
}

function promptRecordKey(record: { requestId: string; toolKey?: string | null }): string {
  return record.toolKey ? `tool:${record.toolKey}` : `id:${record.requestId}`
}

function promptRecordKeyForRequest(request: ChatQuestionRequest): string {
  return promptRecordKey({ requestId: request.id, toolKey: questionRequestToolKey(request) })
}

function promptRecordKeyForTarget(target: QuestionPromptTarget): string {
  return typeof target === "string" ? promptRecordKey({ requestId: target }) : promptRecordKeyForRequest(target)
}

function promptRecordMatchesTarget(record: StoredQuestionPrompt, target: QuestionPromptTarget): boolean {
  if (record.requestId === questionPromptTargetRequestId(target)) {
    return true
  }
  const toolKey = questionPromptTargetToolKey(target)
  return Boolean(toolKey && record.toolKey === toolKey)
}

function findPromptRecordForTarget(
  records: StoredQuestionPrompt[],
  target: QuestionPromptTarget,
): StoredQuestionPrompt | undefined {
  const toolKey = questionPromptTargetToolKey(target)
  if (toolKey) {
    const byToolKey = records.find((record) => record.toolKey === toolKey)
    if (byToolKey) {
      return byToolKey
    }
  }
  const requestId = questionPromptTargetRequestId(target)
  return records.find((record) => record.requestId === requestId)
}

function isStoredQuestionPromptState(value: unknown): value is StoredQuestionPromptState {
  return value === "stopped" || value === "recoverable" || value === "dismissed"
}

function normalizeStoredQuestionDraft(value: unknown): StoredQuestionDraft | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const draft = value as { activeFieldIndex?: unknown; drafts?: unknown; updatedAt?: unknown }
  if (typeof draft.updatedAt !== "number" || !isFresh(draft.updatedAt) || !Array.isArray(draft.drafts)) {
    return null
  }
  const activeFieldIndex = Number.isInteger(draft.activeFieldIndex) ? Number(draft.activeFieldIndex) : 0
  return {
    activeFieldIndex,
    drafts: draft.drafts.map((item) => normalizeDraft(item as QuestionFieldDraft | undefined)),
    updatedAt: draft.updatedAt,
  }
}

function normalizeStoredQuestionPrompt(value: unknown): StoredQuestionPrompt | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const item = value as {
    draft?: unknown
    request?: unknown
    requestId?: unknown
    state?: unknown
    toolKey?: unknown
    updatedAt?: unknown
  }
  if (typeof item.requestId !== "string" || typeof item.updatedAt !== "number" || !isFresh(item.updatedAt)) {
    return null
  }
  const state = isStoredQuestionPromptState(item.state) ? item.state : undefined
  const request = normalizeQuestionRequest(item.request)
  const draft = normalizeStoredQuestionDraft(item.draft)
  const toolKey =
    typeof item.toolKey === "string" && item.toolKey ? item.toolKey : request ? questionRequestToolKey(request) : null
  if (!state && !draft) {
    return null
  }
  if ((state === "stopped" || state === "recoverable") && !request) {
    return null
  }
  return {
    requestId: item.requestId,
    updatedAt: item.updatedAt,
    ...(state ? { state } : {}),
    ...(toolKey ? { toolKey } : {}),
    ...(request ? { request } : {}),
    ...(draft ? { draft } : {}),
  }
}

function storedQuestionPromptChanged(raw: StoredQuestionPrompt, normalized: StoredQuestionPrompt): boolean {
  const rawToolKey = typeof raw.toolKey === "string" && raw.toolKey ? raw.toolKey : undefined
  if (
    raw.requestId !== normalized.requestId ||
    raw.updatedAt !== normalized.updatedAt ||
    raw.state !== normalized.state ||
    rawToolKey !== normalized.toolKey
  ) {
    return true
  }
  if (Boolean(raw.request) !== Boolean(normalized.request) || Boolean(raw.draft) !== Boolean(normalized.draft)) {
    return true
  }
  if (normalized.request && JSON.stringify(raw.request) !== JSON.stringify(normalized.request)) {
    return true
  }
  return Boolean(normalized.draft && JSON.stringify(raw.draft) !== JSON.stringify(normalized.draft))
}

function pruneQuestionPrompts(
  stored: StoredQuestionPromptsBySession,
  now = Date.now(),
): StoredQuestionPromptsBySession {
  let changed = false
  const next: StoredQuestionPromptsBySession = {}
  for (const [sessionId, items] of Object.entries(stored)) {
    const normalizedItems: StoredQuestionPrompt[] = []
    if (!Array.isArray(items)) {
      changed = true
      continue
    }
    for (const item of items) {
      const normalized = normalizeStoredQuestionPrompt(item)
      if (!normalized || !isFresh(normalized.updatedAt, now)) {
        changed = true
        continue
      }
      if (storedQuestionPromptChanged(item, normalized)) {
        changed = true
      }
      normalizedItems.push(normalized)
    }
    if (normalizedItems.length > 0) {
      next[sessionId] = normalizedItems
    } else if (items.length > 0) {
      changed = true
    }
  }
  return changed ? next : stored
}

function upsertPromptRecord(
  records: StoredQuestionPrompt[],
  key: string,
  updater: (current: StoredQuestionPrompt | undefined) => StoredQuestionPrompt | null,
): StoredQuestionPrompt[] {
  const existingIndex = records.findIndex((record) => promptRecordKey(record) === key)
  const current = existingIndex >= 0 ? records[existingIndex] : undefined
  const updated = updater(current)
  if (!updated) {
    return existingIndex >= 0 ? records.filter((_, index) => index !== existingIndex) : records
  }
  if (existingIndex < 0) {
    return [...records, updated]
  }
  const next = records.slice()
  next[existingIndex] = updated
  return next
}

function updatePromptStoreForSession(
  sessionId: string,
  updater: (records: StoredQuestionPrompt[]) => StoredQuestionPrompt[],
): void {
  const stored = readQuestionPromptStore()
  const records = stored[sessionId] ?? []
  const nextRecords = updater(records)
  const next = { ...stored }
  if (nextRecords.length > 0) {
    next[sessionId] = nextRecords
  } else {
    delete next[sessionId]
  }
  writeJson(questionPromptsStorageKey, pruneQuestionPrompts(next))
}

function legacyStoppedRecords(
  storageKey: string,
  state: Extract<StoredQuestionPromptState, "stopped" | "recoverable">,
): StoredQuestionPromptsBySession {
  const stored = pruneStoppedQuestions(readJson<StoredStoppedQuestionsBySession>(storageKey, {}))
  const next: StoredQuestionPromptsBySession = {}
  for (const [sessionId, items] of Object.entries(stored)) {
    for (const item of items) {
      const request = stoppedQuestionItemRequest(item)
      const updatedAt = stoppedQuestionItemUpdatedAt(item) ?? Date.now()
      if (!isFresh(updatedAt)) {
        continue
      }
      const toolKey = questionRequestToolKey(request)
      next[sessionId] = [
        ...(next[sessionId] ?? []),
        {
          request,
          requestId: request.id,
          state,
          ...(toolKey ? { toolKey } : {}),
          updatedAt,
        },
      ]
    }
  }
  return next
}

function mergeLegacyPromptRecords(
  target: StoredQuestionPromptsBySession,
  records: StoredQuestionPromptsBySession,
): StoredQuestionPromptsBySession {
  let next = target
  for (const [sessionId, items] of Object.entries(records)) {
    const existing = next[sessionId] ?? []
    let sessionRecords = existing
    for (const item of items) {
      const existingKeyByRequest = sessionRecords.find((record) => record.requestId === item.requestId)
      const key = existingKeyByRequest ? promptRecordKey(existingKeyByRequest) : promptRecordKey(item)
      sessionRecords = upsertPromptRecord(sessionRecords, key, (current) => {
        if (current?.state === "dismissed" || (current?.state === "stopped" && item.state === "recoverable")) {
          return current
        }
        return {
          ...current,
          ...item,
          draft: item.draft ?? current?.draft,
          updatedAt: Math.max(current?.updatedAt ?? 0, item.updatedAt),
        }
      })
    }
    next = { ...next, [sessionId]: sessionRecords }
  }
  return next
}

function legacyDraftRecords(): StoredQuestionPromptsBySession {
  const stored = pruneQuestionDrafts(readJson<StoredQuestionDraftsBySession>(questionDraftsStorageKey, {}))
  const next: StoredQuestionPromptsBySession = {}
  for (const [sessionId, draftsByRequest] of Object.entries(stored)) {
    for (const [requestId, draft] of Object.entries(draftsByRequest)) {
      if (!isFresh(draft.updatedAt)) {
        continue
      }
      next[sessionId] = [
        ...(next[sessionId] ?? []),
        {
          draft: {
            activeFieldIndex: draft.activeFieldIndex,
            drafts: draft.drafts.map(normalizeDraft),
            updatedAt: draft.updatedAt,
          },
          requestId,
          updatedAt: draft.updatedAt,
        },
      ]
    }
  }
  return next
}

function legacyDismissedRecords(): StoredQuestionPromptsBySession {
  const stored = pruneDismissedQuestions(readJson<StoredDismissedQuestionsBySession>(dismissedQuestionsStorageKey, {}))
  const next: StoredQuestionPromptsBySession = {}
  for (const [sessionId, items] of Object.entries(stored)) {
    for (const item of items) {
      const normalized = normalizeStoredDismissedQuestion(item)
      if (!normalized) {
        continue
      }
      next[sessionId] = [
        ...(next[sessionId] ?? []),
        {
          requestId: normalized.requestId,
          state: "dismissed",
          ...(normalized.toolKey ? { toolKey: normalized.toolKey } : {}),
          updatedAt: normalized.updatedAt,
        },
      ]
    }
  }
  return next
}

function migrateLegacyQuestionPromptStore(): StoredQuestionPromptsBySession {
  let migrated: StoredQuestionPromptsBySession = {}
  migrated = mergeLegacyPromptRecords(migrated, legacyStoppedRecords(stoppedQuestionsStorageKey, "stopped"))
  migrated = mergeLegacyPromptRecords(migrated, legacyStoppedRecords(recoverableQuestionsStorageKey, "recoverable"))
  migrated = mergeLegacyPromptRecords(migrated, legacyDraftRecords())
  migrated = mergeLegacyPromptRecords(migrated, legacyDismissedRecords())
  return pruneQuestionPrompts(migrated)
}

function readQuestionPromptStore(): StoredQuestionPromptsBySession {
  const stored = readJson<StoredQuestionPromptsBySession | null>(questionPromptsStorageKey, null)
  if (stored) {
    const pruned = pruneQuestionPrompts(stored)
    if (pruned !== stored) {
      writeJson(questionPromptsStorageKey, pruned)
    }
    return pruned
  }
  const migrated = migrateLegacyQuestionPromptStore()
  if (Object.keys(migrated).length > 0) {
    writeJson(questionPromptsStorageKey, migrated)
  }
  return migrated
}

function promptRecordsForSession(sessionId: string): StoredQuestionPrompt[] {
  return readQuestionPromptStore()[sessionId] ?? []
}

function readStoredQuestionPrompts(
  sessionId: string,
  state: Extract<StoredQuestionPromptState, "stopped" | "recoverable">,
): ChatQuestionRequest[] {
  return promptRecordsForSession(sessionId).flatMap((item) =>
    item.state === state && item.request ? [item.request] : [],
  )
}

export function readStoredQuestionPromptSnapshot(sessionId: string): StoredQuestionPromptSnapshot {
  const records = promptRecordsForSession(sessionId)
  return {
    dismissedQuestions: records
      .filter((item) => item.state === "dismissed")
      .map((item) => ({ requestId: item.requestId, toolKey: item.toolKey ?? null })),
    recoverableQuestions: records.flatMap((item) =>
      item.state === "recoverable" && item.request ? [item.request] : [],
    ),
    stoppedQuestions: records.flatMap((item) => (item.state === "stopped" && item.request ? [item.request] : [])),
  }
}

function addStoredQuestionPrompts(
  sessionId: string,
  state: Extract<StoredQuestionPromptState, "stopped" | "recoverable">,
  requests: ChatQuestionRequest[],
): void {
  if (requests.length === 0) {
    return
  }
  updatePromptStoreForSession(sessionId, (records) => {
    let next = records
    for (const request of requests) {
      const key = promptRecordKeyForRequest(request)
      const toolKey = questionRequestToolKey(request)
      next = upsertPromptRecord(next, key, (current) => {
        if (current?.state === "dismissed" || (current?.state === "stopped" && state === "recoverable")) {
          return current
        }
        return {
          ...current,
          request,
          requestId: request.id,
          state,
          ...(toolKey ? { toolKey } : {}),
          updatedAt: Date.now(),
        }
      })
    }
    return next
  })
}

function removeStoredQuestionPromptState(
  sessionId: string,
  state: Extract<StoredQuestionPromptState, "stopped" | "recoverable">,
  target: QuestionPromptTarget,
): void {
  updatePromptStoreForSession(sessionId, (records) =>
    records.flatMap((record) => {
      if (record.state !== state || !promptRecordMatchesTarget(record, target)) {
        return [record]
      }
      const { request: _request, state: _state, ...rest } = record
      return rest.draft ? [{ ...rest, updatedAt: Date.now() }] : []
    }),
  )
}

export function readStoredStoppedQuestions(sessionId: string): ChatQuestionRequest[] {
  return readStoredQuestionPrompts(sessionId, "stopped")
}

export function addStoredStoppedQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  addStoredQuestionPrompts(sessionId, "stopped", requests)
}

export function removeStoredStoppedQuestion(sessionId: string, target: QuestionPromptTarget): void {
  removeStoredQuestionPromptState(sessionId, "stopped", target)
}

export function readStoredRecoverableQuestions(sessionId: string): ChatQuestionRequest[] {
  return readStoredQuestionPrompts(sessionId, "recoverable")
}

export function addStoredRecoverableQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  addStoredQuestionPrompts(sessionId, "recoverable", requests)
}

export function removeStoredRecoverableQuestion(sessionId: string, target: QuestionPromptTarget): void {
  removeStoredQuestionPromptState(sessionId, "recoverable", target)
}

export function readStoredDismissedQuestions(sessionId: string): QuestionDismissal[] {
  return promptRecordsForSession(sessionId)
    .filter((item) => item.state === "dismissed")
    .map((item) => ({ requestId: item.requestId, toolKey: item.toolKey ?? null }))
}

export function addStoredDismissedQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  if (requests.length === 0) {
    return
  }
  updatePromptStoreForSession(sessionId, (records) => {
    let next = records
    for (const request of requests) {
      const dismissal = questionDismissal(request)
      next = upsertPromptRecord(next, dismissalStorageKey(dismissal), (current) => ({
        ...current,
        requestId: dismissal.requestId,
        state: "dismissed",
        ...(dismissal.toolKey ? { toolKey: dismissal.toolKey } : {}),
        updatedAt: Date.now(),
      }))
    }
    return next
  })
}

export function readStoredQuestionDraft(
  sessionId: string,
  target: QuestionPromptTarget,
  expectedDraftCount: number,
): StoredQuestionDraftSnapshot | null {
  const item = findPromptRecordForTarget(promptRecordsForSession(sessionId), target)?.draft
  if (!item || !Array.isArray(item.drafts) || item.drafts.length !== expectedDraftCount) {
    return null
  }
  const activeFieldIndex = Number.isInteger(item.activeFieldIndex)
    ? Math.min(Math.max(item.activeFieldIndex, 0), Math.max(0, expectedDraftCount - 1))
    : 0
  return {
    activeFieldIndex,
    drafts: item.drafts.map(normalizeDraft),
  }
}

export function writeStoredQuestionDraft(
  sessionId: string,
  target: QuestionPromptTarget,
  snapshot: StoredQuestionDraftSnapshot,
): void {
  updatePromptStoreForSession(sessionId, (records) => {
    const existing = findPromptRecordForTarget(records, target)
    const key = existing ? promptRecordKey(existing) : promptRecordKeyForTarget(target)
    const requestId = questionPromptTargetRequestId(target)
    const toolKey = questionPromptTargetToolKey(target)
    return upsertPromptRecord(records, key, (current) => ({
      ...current,
      draft: {
        activeFieldIndex: snapshot.activeFieldIndex,
        drafts: snapshot.drafts.map(normalizeDraft),
        updatedAt: Date.now(),
      },
      requestId,
      ...(toolKey ? { toolKey } : {}),
      updatedAt: Date.now(),
    }))
  })
}

export function removeStoredQuestionDraft(sessionId: string, target: QuestionPromptTarget): void {
  updatePromptStoreForSession(sessionId, (records) =>
    records.flatMap((record) => {
      if (!promptRecordMatchesTarget(record, target) || !record.draft) {
        return [record]
      }
      const { draft: _draft, ...rest } = record
      return rest.state ? [{ ...rest, updatedAt: Date.now() }] : []
    }),
  )
}
