import type { ChatMessage, ChatMessagePart, ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { normalizeQuestionInfo } from "./question-request-normalization.ts"

type StoppedQuestionsMap = Record<string, string[]>
export type QuestionPromptTarget = string | ChatQuestionRequest

export interface QuestionDismissal {
  requestId: string
  toolKey: string | null
}

export interface PendingQuestionReconciliationInput {
  currentMessages: ChatMessage[] | null
  dismissedQuestions: QuestionDismissal[]
  fetchedQuestions: ChatQuestionRequest[] | null
  previousQuestions: ChatQuestionRequest[]
  sessionId: string
  stoppedQuestionIds: string[]
  storedRecoverableQuestions: ChatQuestionRequest[]
  storedStoppedQuestions: ChatQuestionRequest[]
}

export interface PendingQuestionReconciliation {
  pendingQuestions: ChatQuestionRequest[]
  recoverableQuestionIdsToRemove: string[]
  recoveredQuestionsToStore: ChatQuestionRequest[]
  shouldApplyPendingQuestions: boolean
  stoppedQuestionIdsToRemove: string[]
  stoppedQuestionIds: string[]
}

function stringSetsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function questionRequestToolKey(request: ChatQuestionRequest): string | null {
  // request id 可能在恢复时重建；tool key 用 messageId+callId 稳定识别同一个 question 工具。
  return request.tool ? `${request.tool.messageId}\0${request.tool.callId}` : null
}

export function questionPromptTargetRequestId(target: QuestionPromptTarget): string {
  return typeof target === "string" ? target : target.id
}

export function questionPromptTargetToolKey(target: QuestionPromptTarget): string | null {
  return typeof target === "string" ? null : questionRequestToolKey(target)
}

export function questionRequestMatchesTarget(request: ChatQuestionRequest, target: QuestionPromptTarget): boolean {
  if (request.id === questionPromptTargetRequestId(target)) {
    return true
  }
  const targetToolKey = questionPromptTargetToolKey(target)
  return Boolean(targetToolKey && questionRequestToolKey(request) === targetToolKey)
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

function fetchedQuestionIdentitySets(fetchedQuestions: ChatQuestionRequest[]): {
  ids: Set<string>
  toolKeys: Set<string>
} {
  return {
    ids: new Set(fetchedQuestions.map((request) => request.id)),
    toolKeys: new Set(
      fetchedQuestions
        .map(questionRequestToolKey)
        .filter((key): key is NonNullable<typeof key> => typeof key === "string"),
    ),
  }
}

function matchesFetchedQuestion(
  request: ChatQuestionRequest,
  fetchedIds: Set<string>,
  fetchedToolKeys: Set<string>,
): boolean {
  const toolKey = questionRequestToolKey(request)
  return fetchedIds.has(request.id) || Boolean(toolKey && fetchedToolKeys.has(toolKey))
}

export function isQuestionToolResolved(messages: ChatMessage[], request: ChatQuestionRequest): boolean {
  const tool = request.tool
  if (!tool) {
    return false
  }
  return messages.some(
    (message) =>
      message.id === tool.messageId &&
      message.parts.some(
        (part) =>
          part.kind === "tool" &&
          part.tool === "question" &&
          part.callId === tool.callId &&
          (part.status === "completed" || part.status === "error"),
      ),
  )
}

export function reconcilePendingQuestions(input: PendingQuestionReconciliationInput): PendingQuestionReconciliation {
  const fetchedQuestions = input.fetchedQuestions ?? []
  const visibleFetchedQuestions = fetchedQuestions.filter(
    (request) => !isQuestionDismissed(request, input.dismissedQuestions),
  )
  const { ids: fetchedIds, toolKeys: fetchedToolKeys } = fetchedQuestionIdentitySets(visibleFetchedQuestions)
  const recoveredQuestionsToStore = input.currentMessages
    ? recoverQuestionsFromMessageTools(
        input.sessionId,
        input.currentMessages,
        visibleFetchedQuestions,
        input.dismissedQuestions,
      )
    : []
  const stoppedQuestionIdsToRemove: string[] = []
  const storedStoppedQuestions = input.storedStoppedQuestions.filter((request) => {
    if (
      isQuestionDismissed(request, input.dismissedQuestions) ||
      matchesFetchedQuestion(request, fetchedIds, fetchedToolKeys)
    ) {
      stoppedQuestionIdsToRemove.push(request.id)
      return false
    }
    return true
  })
  const storedStoppedIds = new Set(storedStoppedQuestions.map((request) => request.id))
  const messagesForRecovery = input.currentMessages ?? []
  const removeResolvedRecoverableQuestions = input.fetchedQuestions !== null
  const recoverableQuestionIdsToRemove: string[] = []
  const storedRecoverableQuestions = input.storedRecoverableQuestions.filter((request) => {
    if (
      isQuestionDismissed(request, input.dismissedQuestions) ||
      matchesFetchedQuestion(request, fetchedIds, fetchedToolKeys) ||
      (removeResolvedRecoverableQuestions && isQuestionToolResolved(messagesForRecovery, request))
    ) {
      recoverableQuestionIdsToRemove.push(request.id)
      return false
    }
    return true
  })
  const stoppedQuestionIds = input.stoppedQuestionIds.filter(
    (requestId) => !fetchedIds.has(requestId) && storedStoppedIds.has(requestId),
  )
  for (const request of storedStoppedQuestions) {
    if (!stoppedQuestionIds.includes(request.id)) {
      stoppedQuestionIds.push(request.id)
    }
  }
  const recoverableQuestions = [...storedRecoverableQuestions, ...recoveredQuestionsToStore]
  return {
    pendingQuestions: mergePendingQuestionsWithStopped({
      dismissedQuestions: input.dismissedQuestions,
      fetchedQuestions: visibleFetchedQuestions,
      previousQuestions: input.previousQuestions,
      storedRecoverableQuestions: recoverableQuestions,
      stoppedQuestionIds,
      storedStoppedQuestions,
    }),
    recoverableQuestionIdsToRemove,
    recoveredQuestionsToStore,
    shouldApplyPendingQuestions:
      input.fetchedQuestions !== null || storedStoppedQuestions.length > 0 || recoverableQuestions.length > 0,
    stoppedQuestionIdsToRemove,
    stoppedQuestionIds,
  }
}

export function setSessionStoppedQuestionIds(
  current: StoppedQuestionsMap,
  sessionId: string,
  stoppedQuestionIds: string[],
): StoppedQuestionsMap {
  if (stoppedQuestionIds.length === 0) {
    if (!Object.hasOwn(current, sessionId)) {
      return current
    }
    const next = { ...current }
    delete next[sessionId]
    return next
  }
  const currentIds = current[sessionId] ?? []
  return stringSetsEqual(stoppedQuestionIds, currentIds) ? current : { ...current, [sessionId]: stoppedQuestionIds }
}

export function removeStoppedQuestionIds(
  stoppedIds: string[],
  pendingQuestions: ChatQuestionRequest[],
  target: QuestionPromptTarget,
): string[] {
  const idsToRemove = new Set([questionPromptTargetRequestId(target)])
  const targetToolKey = questionPromptTargetToolKey(target)
  if (targetToolKey) {
    for (const request of pendingQuestions) {
      if (questionRequestToolKey(request) === targetToolKey) {
        idsToRemove.add(request.id)
      }
    }
  }
  if (!stoppedIds.some((requestId) => idsToRemove.has(requestId))) {
    return stoppedIds
  }
  return stoppedIds.filter((requestId) => !idsToRemove.has(requestId))
}
