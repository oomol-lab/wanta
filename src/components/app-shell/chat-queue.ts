import type { ChatAttachment } from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { ChatStatus } from "ai"

export interface QueuedChatMessage {
  id: string
  sessionId: string
  text: string
  attachments: ChatAttachment[]
  model?: ModelChoice
  createdAt: number
}

export type ChatQueueMap = Record<string, QueuedChatMessage[]>

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

export function clearQueuedMessages(queues: ChatQueueMap, sessionId: string): ChatQueueMap {
  if (!queues[sessionId]) {
    return queues
  }
  const next = { ...queues }
  delete next[sessionId]
  return next
}

export function consumeLatestQueuedMessage(
  queues: ChatQueueMap,
  sessionId: string,
): { queues: ChatQueueMap; message: QueuedChatMessage | null } {
  const queue = queues[sessionId] ?? []
  const message = queue.at(-1) ?? null
  if (!message) {
    return { queues, message: null }
  }
  const nextQueue = queue.slice(0, -1)
  const next = { ...queues }
  if (nextQueue.length === 0) {
    delete next[sessionId]
  } else {
    next[sessionId] = nextQueue
  }
  return { queues: next, message }
}

export function shouldDispatchQueuedMessage(status: ChatStatus, initialSendPending: boolean): boolean {
  return status === "ready" && !initialSendPending
}
