import type { ChatAttachment, ChatContextMention } from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { ChatStatus } from "ai"

export interface QueuedChatMessage {
  id: string
  sessionId: string
  text: string
  attachments: ChatAttachment[]
  contextMentions?: ChatContextMention[]
  model?: ModelChoice
  createdAt: number
}

export type ChatQueueMap = Record<string, QueuedChatMessage[]>
export type QueuedMessageMovePlacement = "after" | "before"

export function appendQueuedMessage(queues: ChatQueueMap, message: QueuedChatMessage): ChatQueueMap {
  return {
    ...queues,
    [message.sessionId]: [...(queues[message.sessionId] ?? []), message],
  }
}

export function removeQueuedMessage(queues: ChatQueueMap, sessionId: string, messageId: string): ChatQueueMap {
  const queue = queues[sessionId]
  if (!queue) {
    return queues
  }
  const nextQueue = queue.filter((message) => message.id !== messageId)
  if (nextQueue.length === queue.length) {
    return queues
  }
  const next = { ...queues }
  if (nextQueue.length === 0) {
    delete next[sessionId]
  } else {
    next[sessionId] = nextQueue
  }
  return next
}

export function moveQueuedMessage(
  queues: ChatQueueMap,
  sessionId: string,
  messageId: string,
  targetId: string,
  placement: QueuedMessageMovePlacement,
): ChatQueueMap {
  if (messageId === targetId) {
    return queues
  }
  const queue = queues[sessionId]
  if (!queue) {
    return queues
  }
  const sourceIndex = queue.findIndex((message) => message.id === messageId)
  const targetIndex = queue.findIndex((message) => message.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) {
    return queues
  }

  const nextQueue = queue.slice()
  const [message] = nextQueue.splice(sourceIndex, 1)
  const targetIndexAfterRemoval = nextQueue.findIndex((item) => item.id === targetId)
  const insertIndex = placement === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1
  nextQueue.splice(insertIndex, 0, message)

  return {
    ...queues,
    [sessionId]: nextQueue,
  }
}

export function clearQueuedMessages(queues: ChatQueueMap, sessionId: string): ChatQueueMap {
  if (!queues[sessionId]) {
    return queues
  }
  const next = { ...queues }
  delete next[sessionId]
  return next
}

export function consumeNextQueuedMessage(
  queues: ChatQueueMap,
  sessionId: string,
): { queues: ChatQueueMap; message: QueuedChatMessage | null } {
  const queue = queues[sessionId] ?? []
  const message = queue[0] ?? null
  if (!message) {
    return { queues, message: null }
  }
  const nextQueue = queue.slice(1)
  const next = { ...queues }
  if (nextQueue.length === 0) {
    delete next[sessionId]
  } else {
    next[sessionId] = nextQueue
  }
  return { queues: next, message }
}

export function latestQueuedMessage(queues: ChatQueueMap, sessionId: string): QueuedChatMessage | null {
  return queues[sessionId]?.at(-1) ?? null
}

export function shouldDispatchQueuedMessage(
  status: ChatStatus,
  initialSendPending: boolean,
  queueHeld: boolean,
): boolean {
  return status === "ready" && !initialSendPending && !queueHeld
}
