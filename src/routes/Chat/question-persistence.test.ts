import type { ChatMessage, ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  addStoredDismissedQuestions,
  addStoredRecoverableQuestions,
  addStoredStoppedQuestions,
  isQuestionDismissed,
  mergePendingQuestionsWithStopped,
  readStoredDismissedQuestions,
  readStoredRecoverableQuestions,
  recoverQuestionsFromMessageTools,
  readStoredQuestionDraft,
  readStoredStoppedQuestions,
  removeStoredRecoverableQuestion,
  removeStoredQuestionDraft,
  removeStoredStoppedQuestion,
  writeStoredQuestionDraft,
} from "./question-persistence.ts"

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  } as Storage
}

function question(id: string): ChatQuestionRequest {
  return {
    id,
    sessionId: "s1",
    questions: [{ header: "回答", question: `问题 ${id}`, options: [] }],
  }
}

const stoppedQuestionsStorageKey = "wanta:chat:stopped-questions:v1"
const recoverableQuestionsStorageKey = "wanta:chat:recoverable-questions:v1"
const questionDraftsStorageKey = "wanta:chat:question-drafts:v1"
const dismissedQuestionsStorageKey = "wanta:chat:dismissed-questions:v1"
const staleUpdatedAt = Date.now() - 15 * 24 * 60 * 60 * 1000

describe("question persistence", () => {
  const originalLocalStorage = globalThis.localStorage

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    })
  })

  it("stores and removes stopped questions by session", () => {
    addStoredStoppedQuestions("s1", [question("q1")])
    addStoredStoppedQuestions("s1", [question("q2")])
    addStoredStoppedQuestions("s2", [question("q3")])

    expect(readStoredStoppedQuestions("s1").map((request) => request.id)).toEqual(["q1", "q2"])

    removeStoredStoppedQuestion("s1", "q1")

    expect(readStoredStoppedQuestions("s1").map((request) => request.id)).toEqual(["q2"])
    expect(readStoredStoppedQuestions("s2").map((request) => request.id)).toEqual(["q3"])
  })

  it("stores and removes recoverable active questions by session", () => {
    addStoredRecoverableQuestions("s1", [question("q1")])
    addStoredRecoverableQuestions("s1", [question("q2")])
    addStoredRecoverableQuestions("s2", [question("q3")])

    expect(readStoredRecoverableQuestions("s1").map((request) => request.id)).toEqual(["q1", "q2"])

    removeStoredRecoverableQuestion("s1", "q1")

    expect(readStoredRecoverableQuestions("s1").map((request) => request.id)).toEqual(["q2"])
    expect(readStoredRecoverableQuestions("s2").map((request) => request.id)).toEqual(["q3"])
  })

  it("stores dismissed questions by tool identity", () => {
    const dismissed = { ...question("q1"), tool: { messageId: "m1", callId: "call-1" } }
    const recovered = { ...question("recovered:m1:call-1"), tool: { messageId: "m1", callId: "call-1" } }

    addStoredDismissedQuestions("s1", [dismissed])

    const dismissals = readStoredDismissedQuestions("s1")
    expect(dismissals).toEqual([{ requestId: "q1", toolKey: "m1\0call-1" }])
    expect(isQuestionDismissed(dismissed, dismissals)).toBe(true)
    expect(isQuestionDismissed(recovered, dismissals)).toBe(true)
  })

  it("stores and removes field drafts by request", () => {
    writeStoredQuestionDraft("s1", "q1", {
      activeFieldIndex: 1,
      drafts: [
        { selected: [], value: "foo@example.com" },
        { selected: ["测试连接"], value: "" },
      ],
    })

    expect(readStoredQuestionDraft("s1", "q1", 2)).toEqual({
      activeFieldIndex: 1,
      drafts: [
        { selected: [], value: "foo@example.com" },
        { selected: ["测试连接"], value: "" },
      ],
    })
    expect(readStoredQuestionDraft("s1", "q1", 1)).toBeNull()

    removeStoredQuestionDraft("s1", "q1")

    expect(readStoredQuestionDraft("s1", "q1", 2)).toBeNull()
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

  it("prefers backend active questions over stopped copies with the same tool call", () => {
    const stopped = { ...question("old"), tool: { messageId: "m1", callId: "call-1" } }
    const active = { ...question("new"), tool: { messageId: "m1", callId: "call-1" } }

    expect(
      mergePendingQuestionsWithStopped({
        fetchedQuestions: [active],
        previousQuestions: [stopped],
        stoppedQuestionIds: ["old"],
        storedStoppedQuestions: [stopped],
      }).map((request) => request.id),
    ).toEqual(["new"])
  })

  it("deduplicates merged questions by id and tool call", () => {
    const recovered = { ...question("recovered"), tool: { messageId: "m1", callId: "call-1" } }
    const active = { ...question("active"), tool: { messageId: "m1", callId: "call-1" } }

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
    const dismissed = { ...question("old"), tool: { messageId: "m1", callId: "call-1" } }
    const recovered = { ...question("recovered"), tool: { messageId: "m1", callId: "call-1" } }
    const active = { ...question("active"), tool: { messageId: "m1", callId: "call-1" } }
    const visible = { ...question("visible"), tool: { messageId: "m2", callId: "call-2" } }

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

  it("recovers stopped questions from waiting question tool parts", () => {
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

  it("does not recover a waiting question tool part already returned by the backend", () => {
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
            input: { questions: [{ header: "Email", question: "Recipient email", options: [] }] },
          },
        ],
      },
    ]
    const fetched = { ...question("q1"), tool: { messageId: "m1", callId: "call-1" } }

    expect(recoverQuestionsFromMessageTools("s1", messages, [fetched])).toEqual([])
  })

  it("does not recover a dismissed waiting question tool part", () => {
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
            input: { questions: [{ header: "Email", question: "Recipient email", options: [] }] },
          },
        ],
      },
    ]

    expect(recoverQuestionsFromMessageTools("s1", messages, [], [{ requestId: "q1", toolKey: "m1\0call-1" }])).toEqual(
      [],
    )
  })

  it("prunes expired stopped questions and drafts during reads", () => {
    globalThis.localStorage.setItem(
      stoppedQuestionsStorageKey,
      JSON.stringify({
        s1: [{ request: question("q1"), updatedAt: staleUpdatedAt }],
      }),
    )
    globalThis.localStorage.setItem(
      recoverableQuestionsStorageKey,
      JSON.stringify({
        s1: [{ request: question("q1"), updatedAt: staleUpdatedAt }],
      }),
    )
    globalThis.localStorage.setItem(
      questionDraftsStorageKey,
      JSON.stringify({
        s1: {
          q1: {
            activeFieldIndex: 0,
            drafts: [{ selected: [], value: "old" }],
            updatedAt: staleUpdatedAt,
          },
        },
      }),
    )
    globalThis.localStorage.setItem(
      dismissedQuestionsStorageKey,
      JSON.stringify({
        s1: [{ requestId: "q1", toolKey: "m1\0call-1", updatedAt: staleUpdatedAt }],
      }),
    )

    expect(readStoredStoppedQuestions("s1")).toEqual([])
    expect(readStoredRecoverableQuestions("s1")).toEqual([])
    expect(readStoredQuestionDraft("s1", "q1", 1)).toBeNull()
    expect(readStoredDismissedQuestions("s1")).toEqual([])
  })
})
