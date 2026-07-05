import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { QuestionFieldDraft } from "./question-fields.ts"

const stoppedQuestionsStorageKey = "wanta:chat:stopped-questions:v1"
const questionDraftsStorageKey = "wanta:chat:question-drafts:v1"
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

type StoredQuestionDraftsBySession = Record<string, Record<string, StoredQuestionDraft>>
type StoredStoppedQuestionsBySession = Record<string, Array<ChatQuestionRequest | StoredStoppedQuestion>>

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

export function readStoredStoppedQuestions(sessionId: string): ChatQuestionRequest[] {
  const stored = readJson<StoredStoppedQuestionsBySession>(stoppedQuestionsStorageKey, {})
  const pruned = pruneStoppedQuestions(stored)
  if (pruned !== stored) {
    writeJson(stoppedQuestionsStorageKey, pruned)
  }
  return Array.isArray(pruned[sessionId]) ? pruned[sessionId].map(stoppedQuestionItemRequest) : []
}

export function addStoredStoppedQuestions(sessionId: string, requests: ChatQuestionRequest[]): void {
  if (requests.length === 0) {
    return
  }
  const stored = pruneStoppedQuestions(readJson<StoredStoppedQuestionsBySession>(stoppedQuestionsStorageKey, {}))
  const byId = new Map((stored[sessionId] ?? []).map((item) => [stoppedQuestionItemRequest(item).id, item]))
  for (const request of requests) {
    byId.set(request.id, { request, updatedAt: Date.now() })
  }
  writeJson(stoppedQuestionsStorageKey, { ...stored, [sessionId]: Array.from(byId.values()) })
}

export function removeStoredStoppedQuestion(sessionId: string, requestId: string): void {
  const raw = readJson<StoredStoppedQuestionsBySession>(stoppedQuestionsStorageKey, {})
  const stored = pruneStoppedQuestions(raw)
  const nextQuestions = (stored[sessionId] ?? []).filter((item) => stoppedQuestionItemRequest(item).id !== requestId)
  if (nextQuestions.length === (stored[sessionId] ?? []).length) {
    if (stored !== raw) {
      writeJson(stoppedQuestionsStorageKey, stored)
    }
    return
  }
  const next = { ...stored }
  if (nextQuestions.length > 0) {
    next[sessionId] = nextQuestions
  } else {
    delete next[sessionId]
  }
  writeJson(stoppedQuestionsStorageKey, next)
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
  fetchedQuestions,
  previousQuestions,
  stoppedQuestionIds,
  storedStoppedQuestions,
}: {
  fetchedQuestions: ChatQuestionRequest[]
  previousQuestions: ChatQuestionRequest[]
  stoppedQuestionIds: string[]
  storedStoppedQuestions: ChatQuestionRequest[]
}): ChatQuestionRequest[] {
  const fetchedIds = new Set(fetchedQuestions.map((request) => request.id))
  const stoppedIds = new Set(stoppedQuestionIds)
  for (const request of storedStoppedQuestions) {
    stoppedIds.add(request.id)
  }
  const stoppedQuestions = new Map<string, ChatQuestionRequest>()
  for (const request of [...storedStoppedQuestions, ...previousQuestions]) {
    if (stoppedIds.has(request.id) && !fetchedIds.has(request.id)) {
      stoppedQuestions.set(request.id, request)
    }
  }
  return [...stoppedQuestions.values(), ...fetchedQuestions]
}
