import type { ChatMessage, ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  isQuestionDismissed,
  mergePendingQuestionsWithStopped,
  reconcilePendingQuestions,
  recoverQuestionsFromMessageTools,
  removeStoppedQuestionIds,
  setSessionStoppedQuestionIds,
} from "./question-model.ts"

function question(id: string, tool?: { messageId: string; callId: string }): ChatQuestionRequest {
  return {
    id,
    sessionId: "s1",
    questions: [{ header: "回答", question: `问题 ${id}`, options: [] }],
    ...(tool ? { tool } : {}),
  }
}

function waitingQuestionMessage(): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    createdAt: 1,
    parts: [
      {
        kind: "tool",
        partId: "part-1",
        callId: "call-1",
        tool: "question",
        status: "running",
        input: {
          questions: [{ header: "Email", question: "Recipient email", options: [] }],
        },
      },
    ],
  }
}

describe("question model", () => {
  it("matches dismissed questions by request id and tool identity", () => {
    const dismissed = question("q1", { messageId: "m1", callId: "call-1" })
    const recovered = question("recovered:m1:call-1", { messageId: "m1", callId: "call-1" })

    expect(isQuestionDismissed(dismissed, [{ requestId: "q1", toolKey: "m1\0call-1" }])).toBe(true)
    expect(isQuestionDismissed(recovered, [{ requestId: "q1", toolKey: "m1\0call-1" }])).toBe(true)
  })

  it("keeps stored stopped questions when the backend pending list is empty", () => {
    expect(
      mergePendingQuestionsWithStopped({
        fetchedQuestions: [],
        previousQuestions: [],
        stoppedQuestionIds: [],
        storedStoppedQuestions: [question("q1")],
      }).map((request) => request.id),
    ).toEqual(["q1"])
  })

  it("keeps stored recoverable questions when the backend pending list is empty", () => {
    expect(
      mergePendingQuestionsWithStopped({
        fetchedQuestions: [],
        previousQuestions: [],
        stoppedQuestionIds: [],
        storedRecoverableQuestions: [question("q1")],
        storedStoppedQuestions: [],
      }).map((request) => request.id),
    ).toEqual(["q1"])
  })

  it("prefers backend active questions over stopped copies with the same id", () => {
    expect(
      mergePendingQuestionsWithStopped({
        fetchedQuestions: [question("q1")],
        previousQuestions: [question("q1")],
        stoppedQuestionIds: ["q1"],
        storedStoppedQuestions: [question("q1")],
      }).map((request) => request.id),
    ).toEqual(["q1"])
  })

  it("prefers backend fetched questions over stopped copies with the same tool call", () => {
    const stopped = question("old", { messageId: "m1", callId: "call-1" })
    const active = question("new", { messageId: "m1", callId: "call-1" })

    const result = reconcilePendingQuestions({
      currentMessages: null,
      dismissedQuestions: [],
      fetchedQuestions: [active],
      previousQuestions: [stopped],
      sessionId: "s1",
      stoppedQuestionIds: ["old"],
      storedRecoverableQuestions: [],
      storedStoppedQuestions: [stopped],
    })

    expect(result.pendingQuestions.map((request) => request.id)).toEqual(["new"])
    expect(result.stoppedQuestionIds).toEqual([])
    expect(result.stoppedQuestionIdsToRemove).toEqual(["old"])
    expect(result.shouldApplyPendingQuestions).toBe(true)
  })

  it("deduplicates merged questions by id and tool call", () => {
    const recovered = question("recovered", { messageId: "m1", callId: "call-1" })
    const active = question("active", { messageId: "m1", callId: "call-1" })

    expect(
      mergePendingQuestionsWithStopped({
        fetchedQuestions: [active, active],
        previousQuestions: [recovered],
        storedRecoverableQuestions: [recovered],
        stoppedQuestionIds: ["recovered"],
        storedStoppedQuestions: [recovered],
      }).map((request) => request.id),
    ).toEqual(["active"])
  })

  it("filters dismissed questions from merged stopped, recoverable, and fetched lists", () => {
    const dismissed = question("old", { messageId: "m1", callId: "call-1" })
    const recovered = question("recovered", { messageId: "m1", callId: "call-1" })
    const active = question("active", { messageId: "m1", callId: "call-1" })
    const visible = question("visible", { messageId: "m2", callId: "call-2" })

    expect(
      mergePendingQuestionsWithStopped({
        dismissedQuestions: [{ requestId: dismissed.id, toolKey: "m1\0call-1" }],
        fetchedQuestions: [active, visible],
        previousQuestions: [dismissed],
        storedRecoverableQuestions: [recovered],
        stoppedQuestionIds: [dismissed.id],
        storedStoppedQuestions: [dismissed],
      }).map((request) => request.id),
    ).toEqual(["visible"])
  })

  it("recovers waiting question tool parts when the backend pending list cannot be fetched", () => {
    const result = reconcilePendingQuestions({
      currentMessages: [waitingQuestionMessage()],
      dismissedQuestions: [],
      fetchedQuestions: null,
      previousQuestions: [],
      sessionId: "s1",
      stoppedQuestionIds: [],
      storedRecoverableQuestions: [],
      storedStoppedQuestions: [],
    })

    expect(result.pendingQuestions).toEqual([
      {
        id: "recovered:m1:call-1",
        sessionId: "s1",
        questions: [{ header: "Email", question: "Recipient email", options: [] }],
        tool: { messageId: "m1", callId: "call-1" },
      },
    ])
    expect(result.recoveredQuestionsToStore.map((request) => request.id)).toEqual(["recovered:m1:call-1"])
    expect(result.shouldApplyPendingQuestions).toBe(true)
  })

  it("recovers active questions from waiting question tool parts", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "question",
            status: "pending",
            input: {
              questions: [
                {
                  header: "Email",
                  question: "Recipient email",
                  options: [{ label: "a@example.com", description: "Use this address" }],
                },
              ],
            },
          },
        ],
      },
    ]

    expect(recoverQuestionsFromMessageTools("s1", messages)).toEqual([
      {
        id: "recovered:m1:call-1",
        sessionId: "s1",
        questions: [
          {
            header: "Email",
            question: "Recipient email",
            options: [{ label: "a@example.com", description: "Use this address" }],
          },
        ],
        tool: { messageId: "m1", callId: "call-1" },
      },
    ])
  })

  it("does not recover cancelled question tool parts as active questions", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "question",
            status: "running",
            cancelled: true,
            input: { questions: [{ header: "Email", question: "Recipient email", options: [] }] },
          },
        ],
      },
    ]

    expect(recoverQuestionsFromMessageTools("s1", messages)).toEqual([])
  })

  it("does not recover a waiting question tool part already returned by the backend", () => {
    const messages = [waitingQuestionMessage()]
    const fetched = question("q1", { messageId: "m1", callId: "call-1" })

    expect(recoverQuestionsFromMessageTools("s1", messages, [fetched])).toEqual([])
  })

  it("does not recover a dismissed waiting question tool part", () => {
    const messages = [waitingQuestionMessage()]

    expect(recoverQuestionsFromMessageTools("s1", messages, [], [{ requestId: "q1", toolKey: "m1\0call-1" }])).toEqual(
      [],
    )
  })

  it("does not clear visible questions on a fetch failure with no local recovery candidates", () => {
    const result = reconcilePendingQuestions({
      currentMessages: null,
      dismissedQuestions: [],
      fetchedQuestions: null,
      previousQuestions: [question("previous")],
      sessionId: "s1",
      stoppedQuestionIds: [],
      storedRecoverableQuestions: [],
      storedStoppedQuestions: [],
    })

    expect(result.pendingQuestions).toEqual([])
    expect(result.shouldApplyPendingQuestions).toBe(false)
  })

  it("updates stopped id maps without replacing unchanged state", () => {
    const current = { s1: ["q1"] }

    expect(setSessionStoppedQuestionIds(current, "s1", ["q1"])).toBe(current)
    expect(setSessionStoppedQuestionIds(current, "s1", [])).toEqual({})
    expect(setSessionStoppedQuestionIds({}, "s1", [])).toEqual({})
    expect(setSessionStoppedQuestionIds({}, "s1", ["q2"])).toEqual({ s1: ["q2"] })
  })

  it("removes stopped ids by request id or stable tool identity", () => {
    const stopped = ["old", "other"]
    const oldRequest = question("old", { messageId: "m1", callId: "call-1" })
    const recoveredRequest = question("recovered:m1:call-1", { messageId: "m1", callId: "call-1" })

    expect(removeStoppedQuestionIds(stopped, [oldRequest], recoveredRequest)).toEqual(["other"])
    expect(removeStoppedQuestionIds(stopped, [], "old")).toEqual(["other"])
    expect(removeStoppedQuestionIds(stopped, [], question("missing"))).toBe(stopped)
  })
})
