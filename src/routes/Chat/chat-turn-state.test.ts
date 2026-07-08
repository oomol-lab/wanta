import { describe, expect, test } from "vitest"
import {
  chatTurnAllowsDirectSend,
  chatTurnAllowsStop,
  chatTurnBlocksQueueDispatch,
  chatTurnQueuesNewMessage,
  chatTurnShowsGenerating,
  resolveChatTurnState,
} from "./chat-turn-state.ts"

describe("chat turn state", () => {
  test("allows direct sends while idle", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 0,
      pendingQuestionCount: 0,
      status: "ready",
    })

    expect(state).toEqual({ chatStatus: "ready", status: "idle" })
    expect(chatTurnAllowsDirectSend(state)).toBe(true)
    expect(chatTurnQueuesNewMessage(state)).toBe(false)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(false)
    expect(chatTurnAllowsStop(state)).toBe(false)
    expect(chatTurnShowsGenerating(state)).toBe(false)
  })

  test("queues new messages while streaming", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 0,
      pendingQuestionCount: 0,
      status: "streaming",
    })

    expect(state).toEqual({ chatStatus: "streaming", status: "streaming" })
    expect(chatTurnAllowsDirectSend(state)).toBe(false)
    expect(chatTurnQueuesNewMessage(state)).toBe(true)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(true)
    expect(chatTurnAllowsStop(state)).toBe(true)
    expect(chatTurnShowsGenerating(state)).toBe(true)
  })

  test("treats pending permissions as an active turn even when chat status is ready", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 1,
      pendingQuestionCount: 0,
      status: "ready",
    })

    expect(state).toEqual({ chatStatus: "ready", pendingPermissionCount: 1, status: "awaiting_permission" })
    expect(chatTurnAllowsDirectSend(state)).toBe(false)
    expect(chatTurnQueuesNewMessage(state)).toBe(true)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(true)
    expect(chatTurnAllowsStop(state)).toBe(false)
    expect(chatTurnShowsGenerating(state)).toBe(false)
  })

  test("keeps pending permissions queueable without showing generation chrome", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 1,
      pendingQuestionCount: 0,
      status: "streaming",
    })

    expect(state).toEqual({ chatStatus: "streaming", pendingPermissionCount: 1, status: "awaiting_permission" })
    expect(chatTurnAllowsDirectSend(state)).toBe(false)
    expect(chatTurnQueuesNewMessage(state)).toBe(true)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(true)
    expect(chatTurnAllowsStop(state)).toBe(false)
    expect(chatTurnShowsGenerating(state)).toBe(false)
  })

  test("keeps question waits queueable and stoppable when the generation is still streaming", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 0,
      pendingQuestionCount: 1,
      status: "streaming",
    })

    expect(state).toEqual({ chatStatus: "streaming", pendingQuestionCount: 1, status: "awaiting_question" })
    expect(chatTurnAllowsDirectSend(state)).toBe(false)
    expect(chatTurnQueuesNewMessage(state)).toBe(true)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(true)
    expect(chatTurnAllowsStop(state)).toBe(true)
    expect(chatTurnShowsGenerating(state)).toBe(false)
  })

  test("does not offer stop for recovered questions without an active generation", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 0,
      pendingQuestionCount: 1,
      status: "ready",
    })

    expect(state).toEqual({ chatStatus: "ready", pendingQuestionCount: 1, status: "awaiting_question" })
    expect(chatTurnAllowsDirectSend(state)).toBe(false)
    expect(chatTurnQueuesNewMessage(state)).toBe(true)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(true)
    expect(chatTurnAllowsStop(state)).toBe(false)
    expect(chatTurnShowsGenerating(state)).toBe(false)
  })

  test("allows direct sends after an error state", () => {
    const state = resolveChatTurnState({
      initialSendPending: false,
      pendingPermissionCount: 0,
      pendingQuestionCount: 0,
      status: "error",
    })

    expect(state).toEqual({ chatStatus: "error", status: "failed" })
    expect(chatTurnAllowsDirectSend(state)).toBe(true)
    expect(chatTurnQueuesNewMessage(state)).toBe(false)
    expect(chatTurnBlocksQueueDispatch(state)).toBe(false)
    expect(chatTurnAllowsStop(state)).toBe(false)
    expect(chatTurnShowsGenerating(state)).toBe(false)
  })
})
