import type { ChatMessage } from "../../../electron/chat/common.ts"
import type { QueuedChatMessage } from "@/components/app-shell/chat-queue"

import { storageKey } from "../../../electron/branding.ts"
import { BUG_REPORT_COMMAND } from "../../../electron/chat/common.ts"
import { visibleUserText } from "./message-text.ts"

const COMPOSER_HISTORY_LIMIT = 20
const COMPOSER_HISTORY_STORAGE_VERSION = 1

export interface ComposerHistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface ComposerHistoryCandidate {
  createdAt: number
  order: number
  text: string
}

export interface ComposerHistoryNavigation {
  index: number | null
  text: string
}

export function composerHistoryStorageKey(scope: string): string {
  return storageKey(`composer-history.v${COMPOSER_HISTORY_STORAGE_VERSION}.${encodeURIComponent(scope)}`)
}

function normalizeHistory(values: unknown, limit = COMPOSER_HISTORY_LIMIT): string[] {
  if (!Array.isArray(values) || limit <= 0) {
    return []
  }
  const history: string[] = []
  for (const value of values) {
    if (typeof value !== "string") {
      continue
    }
    const text = value.trim()
    if (text && !isCommandSubmission(text) && history.at(-1) !== text) {
      history.push(text)
    }
  }
  return history.slice(-limit)
}

function isCommandSubmission(text: string): boolean {
  return text === BUG_REPORT_COMMAND || text.startsWith(`${BUG_REPORT_COMMAND} `)
}

export function readStoredComposerHistory(scope: string, storage: ComposerHistoryStorage = localStorage): string[] {
  try {
    const raw = storage.getItem(composerHistoryStorageKey(scope))
    return raw === null ? [] : normalizeHistory(JSON.parse(raw))
  } catch {
    // localStorage 不可用或内容损坏时，仅退回当前聊天里的历史。
    return []
  }
}

export function appendStoredComposerHistory(
  scope: string,
  text: string,
  storage: ComposerHistoryStorage = localStorage,
): string[] {
  const history = readStoredComposerHistory(scope, storage)
  const next = normalizeHistory([...history, text])
  if (next.length === history.length && next.every((value, index) => value === history[index])) {
    return history
  }
  try {
    storage.setItem(composerHistoryStorageKey(scope), JSON.stringify(next))
  } catch {
    // localStorage 不可用时保留本次渲染进程内的历史。
  }
  return next
}

export function mergeComposerHistories(older: string[], newer: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const text of [...older, ...newer].reverse()) {
    if (!seen.has(text)) {
      seen.add(text)
      merged.push(text)
    }
  }
  return merged.reverse().slice(-COMPOSER_HISTORY_LIMIT)
}

function messageText(message: Pick<ChatMessage, "parts">): string {
  return visibleUserText(
    message.parts
      .filter((part) => part.kind === "text")
      .map((part) => part.text ?? "")
      .join(""),
  ).trim()
}

export function buildComposerHistory(
  messages: Array<Pick<ChatMessage, "createdAt" | "parts" | "role">>,
  queuedMessages: Array<Pick<QueuedChatMessage, "createdAt" | "text">>,
  limit = COMPOSER_HISTORY_LIMIT,
): string[] {
  if (limit <= 0) {
    return []
  }

  let order = 0
  const candidates: ComposerHistoryCandidate[] = []
  for (const message of messages) {
    if (message.role !== "user") {
      continue
    }
    const text = messageText(message)
    if (text && !isCommandSubmission(text)) {
      candidates.push({ createdAt: message.createdAt, order: order++, text })
    }
  }
  for (const message of queuedMessages) {
    const text = message.text.trim()
    if (text && !isCommandSubmission(text)) {
      candidates.push({ createdAt: message.createdAt, order: order++, text })
    }
  }

  candidates.sort((left, right) => left.createdAt - right.createdAt || left.order - right.order)
  const history: string[] = []
  for (const candidate of candidates) {
    if (history.at(-1) !== candidate.text) {
      history.push(candidate.text)
    }
  }
  return normalizeHistory(history, limit)
}

export function navigateComposerHistory(
  history: string[],
  currentIndex: number | null,
  direction: "newer" | "older",
): ComposerHistoryNavigation | null {
  if (history.length === 0 || (currentIndex === null && direction === "newer")) {
    return null
  }

  if (currentIndex === null) {
    const index = history.length - 1
    return { index, text: history[index] ?? "" }
  }

  const boundedIndex = Math.min(Math.max(currentIndex, 0), history.length - 1)
  if (direction === "older") {
    const index = (boundedIndex - 1 + history.length) % history.length
    return { index, text: history[index] ?? "" }
  }
  if (boundedIndex === history.length - 1) {
    return { index: null, text: "" }
  }
  const index = boundedIndex + 1
  return { index, text: history[index] ?? "" }
}
