import type {
  ChatMessage,
  ChatMessagePart,
  ChatQuestionInfo,
  ChatQuestionOption,
  ChatQuestionRequest,
} from "../../../electron/chat/common.ts"
import type { QuestionFieldDraft } from "./question-fields.ts"

const stoppedQuestionsStorageKey = "wanta:chat:stopped-questions:v1"
const recoverableQuestionsStorageKey = "wanta:chat:recoverable-questions:v1"
const questionDraftsStorageKey = "wanta:chat:question-drafts:v1"
const dismissedQuestionsStorageKey = "wanta:chat:dismissed-questions:v1"
const questionPersistenceMaxAgeMs = 14 * 24 * 60 * 60 * 1000

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

type StoredQuestionDraftsBySession = Record<string, Record<string, StoredQuestionDraft>>
type StoredStoppedQuestionsBySession = Record<string, Array<ChatQuestionRequest | StoredStoppedQuestion>>
type StoredDismissedQuestionsBySession = Record<string, StoredDismissedQuestion[]>

export interface QuestionDismissal {
  requestId: string
  toolKey: string | null
}

export interface StoredQuestionDraftSnapshot {
  activeFieldIndex: number
  drafts: QuestionFieldDraft[]
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

function normalizeQuestionOption(value: unknown): ChatQuestionOption | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const option = value as { label?: unknown; description?: unknown }
  if (typeof option.label !== "string" || !option.label.trim()) {
    return null
  }
  return {
    label: option.label,
    ...(typeof option.description === "string" && option.description.trim() ? { description: option.description } : {}),
  }
}

function normalizeQuestionInfo(value: unknown): ChatQuestionInfo | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const question = value as {
    custom?: unknown
    header?: unknown
    multiple?: unknown
    options?: unknown
    question?: unknown
  }
  if (typeof question.question !== "string" || !question.question.trim()) {
    return null
  }
  const header =
    typeof question.header === "string" && question.header.trim() ? question.header.trim() : question.question.trim()
  return {
    question: question.question,
    header,
    options: Array.isArray(question.options)
      ? question.options
          .map(normalizeQuestionOption)
          .filter((option): option is NonNullable<typeof option> => Boolean(option))
      : [],
    ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
    ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
  }
}

export function questionRequestToolKey(request: ChatQuestionRequest): string | null {
  // request id 可能在恢复时重建；tool key 用 messageId+callId 稳定识别同一个 question 工具。
  return request.tool ? `${request.tool.messageId}\0${request.tool.callId}` : null
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

export function isQuestionDismissed(request: ChatQuestionRequest, dismissals: QuestionDismissal[] = []): boolean {
  // 既按 request id 匹配当前待答问题，也按 tool key 屏蔽从消息工具恢复出来的同一问题。
  const requestToolKey = questionRequestToolKey(request)
  return dismissals.some(
    (dismissal) =>
      dismissal.requestId === request.id ||
      (typeof requestToolKey === "string" && dismissal.toolKey === requestToolKey),
  )
}

function isWaitingQuestionToolPart(part: ChatMessagePart): boolean {
  return (
    part.kind === "tool" &&
    part.tool === "question" &&
    typeof part.callId === "string" &&
    part.cancelled !== true &&
    (part.status === "pending" || part.status === "running")
  )
}

function questionRequestFromToolPart(
  sessionId: string,
  messageId: string,
  part: ChatMessagePart,
): ChatQuestionRequest | null {
  if (!isWaitingQuestionToolPart(part) || !part.callId) {
    return null
  }
  const rawQuestions = part.input?.questions
  if (!Array.isArray(rawQuestions)) {
    return null
  }
  const questions = rawQuestions
    .map(normalizeQuestionInfo)
    .filter((question): question is NonNullable<typeof question> => Boolean(question))
  if (questions.length === 0) {
    return null
  }
  return {
    id: `recovered:${messageId}:${part.callId}`,
    sessionId,
    questions,
    tool: {
      messageId,
      callId: part.callId,
    },
  }
}

export function recoverQuestionsFromMessageTools(
  sessionId: string,
  messages: ChatMessage[],
  fetchedQuestions: ChatQuestionRequest[] = [],
  dismissedQuestions: QuestionDismissal[] = [],
): ChatQuestionRequest[] {
  const fetchedToolKeys = new Set(
    fetchedQuestions
      .map(questionRequestToolKey)
      .filter((key): key is NonNullable<typeof key> => typeof key === "string"),
  )
  const recovered = new Map<string, ChatQuestionRequest>()
  for (const message of messages) {
    for (const part of message.parts) {
      const request = questionRequestFromToolPart(sessionId, message.id, part)
      if (!request) {
        continue
      }
      const toolKey = questionRequestToolKey(request)
      if (toolKey && fetchedToolKeys.has(toolKey)) {
        continue
      }
      if (isQuestionDismissed(request, dismissedQuestions)) {
        continue
      }
      recovered.set(toolKey ?? request.id, request)
    }
  }
  return Array.from(recovered.values())
}

function dedupeQuestionRequests(requests: ChatQuestionRequest[]): ChatQuestionRequest[] {
  const byId = new Map<string, ChatQuestionRequest>()
  const idByToolKey = new Map<string, string>()
  for (const request of requests) {
    const toolKey = questionRequestToolKey(request)
    const existingToolRequestId = toolKey ? idByToolKey.get(toolKey) : undefined
    if (existingToolRequestId && existingToolRequestId !== request.id) {
      byId.delete(existingToolRequestId)
    }
    byId.set(request.id, request)
    if (toolKey) {
      idByToolKey.set(toolKey, request.id)
    }
  }
  return Array.from(byId.values())
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

function readStoredQuestionRequests(storageKey: string, sessionId: string): ChatQuestionRequest[] {
  const stored = readJson<StoredStoppedQuestionsBySession>(storageKey, {})
  const pruned = pruneStoppedQuestions(stored)
  if (pruned !== stored) {
    writeJson(storageKey, pruned)
  }
  return Array.isArray(pruned[sessionId]) ? pruned[sessionId].map(stoppedQuestionItemRequest) : []
}

function addStoredQuestionRequests(storageKey: string, sessionId: string, requests: ChatQuestionRequest[]): void {
  if (requests.length === 0) {
    return
  }
  const stored = pruneStoppedQuestions(readJson<StoredStoppedQuestionsBySession>(storageKey, {}))
  const byId = new Map((stored[sessionId] ?? []).map((item) => [stoppedQuestionItemRequest(item).id, item]))
  for (const request of requests) {
    byId.set(request.id, { request, updatedAt: Date.now() })
  }
  writeJson(storageKey, { ...stored, [sessionId]: Array.from(byId.values()) })
}

function removeStoredQuestionRequest(storageKey: string, sessionId: string, requestId: string): void {
  const raw = readJson<StoredStoppedQuestionsBySession>(storageKey, {})
  const stored = pruneStoppedQuestions(raw)
  const nextQuestions = (stored[sessionId] ?? []).filter((item) => stoppedQuestionItemRequest(item).id !== requestId)
  if (nextQuestions.length === (stored[sessionId] ?? []).length) {
    if (stored !== raw) {
      writeJson(storageKey, stored)
    }
    return
  }
  const next = { ...stored }
  if (nextQuestions.length > 0) {
    next[sessionId] = nextQuestions
  } else {
    delete next[sessionId]
  }
  writeJson(storageKey, next)
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

export function readStoredStoppedQuestions(sessionId: string): ChatQuestionRequest[] {
  return readStoredQuestionRequests(stoppedQuestionsStorageKey, sessionId)
}

export function addStoredStoppedQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  addStoredQuestionRequests(stoppedQuestionsStorageKey, sessionId, requests)
}

export function removeStoredStoppedQuestion(sessionId: string, requestId: string): void {
  removeStoredQuestionRequest(stoppedQuestionsStorageKey, sessionId, requestId)
}

export function readStoredRecoverableQuestions(sessionId: string): ChatQuestionRequest[] {
  return readStoredQuestionRequests(recoverableQuestionsStorageKey, sessionId)
}

export function addStoredRecoverableQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  addStoredQuestionRequests(recoverableQuestionsStorageKey, sessionId, requests)
}

export function removeStoredRecoverableQuestion(sessionId: string, requestId: string): void {
  removeStoredQuestionRequest(recoverableQuestionsStorageKey, sessionId, requestId)
}

export function readStoredDismissedQuestions(sessionId: string): QuestionDismissal[] {
  // reloadPendingQuestions 会先读取 dismissed，再过滤 fetched/stopped/recoverable 三类候选。
  const stored = readJson<StoredDismissedQuestionsBySession>(dismissedQuestionsStorageKey, {})
  const pruned = pruneDismissedQuestions(stored)
  if (pruned !== stored) {
    writeJson(dismissedQuestionsStorageKey, pruned)
  }
  return Array.isArray(pruned[sessionId])
    ? pruned[sessionId]
        .map(normalizeStoredDismissedQuestion)
        .filter((item): item is StoredDismissedQuestion => Boolean(item))
        .map((item) => ({ requestId: item.requestId, toolKey: item.toolKey ?? null }))
    : []
}

export function addStoredDismissedQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  if (requests.length === 0) {
    return
  }
  // 用户丢弃问题时记录 dismissed，用于阻止 recoverQuestionsFromMessageTools 再把它恢复出来。
  const stored = pruneDismissedQuestions(readJson<StoredDismissedQuestionsBySession>(dismissedQuestionsStorageKey, {}))
  const byKey = new Map(
    (stored[sessionId] ?? []).map((item) => [
      dismissalStorageKey({ requestId: item.requestId, toolKey: item.toolKey ?? null }),
      item,
    ]),
  )
  for (const request of requests) {
    const dismissal = questionDismissal(request)
    byKey.set(dismissalStorageKey(dismissal), {
      requestId: dismissal.requestId,
      ...(dismissal.toolKey ? { toolKey: dismissal.toolKey } : {}),
      updatedAt: Date.now(),
    })
  }
  writeJson(dismissedQuestionsStorageKey, { ...stored, [sessionId]: Array.from(byKey.values()) })
}

export function readStoredQuestionDraft(
  sessionId: string,
  requestId: string,
  expectedDraftCount: number,
): StoredQuestionDraftSnapshot | null {
  const stored = readJson<StoredQuestionDraftsBySession>(questionDraftsStorageKey, {})
  const pruned = pruneQuestionDrafts(stored)
  if (pruned !== stored) {
    writeJson(questionDraftsStorageKey, pruned)
  }
  const item = pruned[sessionId]?.[requestId]
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
  requestId: string,
  snapshot: StoredQuestionDraftSnapshot,
): void {
  const stored = pruneQuestionDrafts(readJson<StoredQuestionDraftsBySession>(questionDraftsStorageKey, {}))
  const sessionDrafts = stored[sessionId] ?? {}
  writeJson(questionDraftsStorageKey, {
    ...stored,
    [sessionId]: {
      ...sessionDrafts,
      [requestId]: {
        activeFieldIndex: snapshot.activeFieldIndex,
        drafts: snapshot.drafts.map(normalizeDraft),
        updatedAt: Date.now(),
      },
    },
  })
}

export function removeStoredQuestionDraft(sessionId: string, requestId: string): void {
  const raw = readJson<StoredQuestionDraftsBySession>(questionDraftsStorageKey, {})
  const stored = pruneQuestionDrafts(raw)
  const sessionDrafts = stored[sessionId]
  if (!sessionDrafts || !sessionDrafts[requestId]) {
    if (stored !== raw) {
      writeJson(questionDraftsStorageKey, stored)
    }
    return
  }
  const nextSessionDrafts = { ...sessionDrafts }
  delete nextSessionDrafts[requestId]
  const next = { ...stored }
  if (Object.keys(nextSessionDrafts).length > 0) {
    next[sessionId] = nextSessionDrafts
  } else {
    delete next[sessionId]
  }
  writeJson(questionDraftsStorageKey, next)
}

export function mergePendingQuestionsWithStopped({
  dismissedQuestions = [],
  fetchedQuestions,
  previousQuestions,
  storedRecoverableQuestions = [],
  stoppedQuestionIds,
  storedStoppedQuestions,
}: {
  dismissedQuestions?: QuestionDismissal[]
  fetchedQuestions: ChatQuestionRequest[]
  previousQuestions: ChatQuestionRequest[]
  storedRecoverableQuestions?: ChatQuestionRequest[]
  stoppedQuestionIds: string[]
  storedStoppedQuestions: ChatQuestionRequest[]
}): ChatQuestionRequest[] {
  // 合并顺序为 stopped、recoverable、fetched；每一层都先排除 dismissed，尊重用户丢弃动作。
  const visibleFetchedQuestions = fetchedQuestions.filter(
    (request) => !isQuestionDismissed(request, dismissedQuestions),
  )
  const fetchedIds = new Set(visibleFetchedQuestions.map((request) => request.id))
  const fetchedToolKeys = new Set(
    visibleFetchedQuestions
      .map(questionRequestToolKey)
      .filter((key): key is NonNullable<typeof key> => typeof key === "string"),
  )
  const stoppedIds = new Set(stoppedQuestionIds)
  for (const request of storedStoppedQuestions) {
    stoppedIds.add(request.id)
  }
  const stoppedQuestions = new Map<string, ChatQuestionRequest>()
  for (const request of [...storedStoppedQuestions, ...previousQuestions]) {
    const toolKey = questionRequestToolKey(request)
    if (
      stoppedIds.has(request.id) &&
      !isQuestionDismissed(request, dismissedQuestions) &&
      !fetchedIds.has(request.id) &&
      (!toolKey || !fetchedToolKeys.has(toolKey))
    ) {
      stoppedQuestions.set(request.id, request)
    }
  }
  const recoverableQuestions = new Map<string, ChatQuestionRequest>()
  const stoppedToolKeys = new Set(
    Array.from(stoppedQuestions.values())
      .map(questionRequestToolKey)
      .filter((key): key is NonNullable<typeof key> => typeof key === "string"),
  )
  for (const request of storedRecoverableQuestions) {
    const toolKey = questionRequestToolKey(request)
    if (
      !fetchedIds.has(request.id) &&
      !stoppedQuestions.has(request.id) &&
      !isQuestionDismissed(request, dismissedQuestions) &&
      (!toolKey || (!fetchedToolKeys.has(toolKey) && !stoppedToolKeys.has(toolKey)))
    ) {
      recoverableQuestions.set(request.id, request)
    }
  }
  return dedupeQuestionRequests([
    ...stoppedQuestions.values(),
    ...recoverableQuestions.values(),
    ...visibleFetchedQuestions,
  ])
}
