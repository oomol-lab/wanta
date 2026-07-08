import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  addStoredDismissedQuestions,
  addStoredRecoverableQuestions,
  addStoredStoppedQuestions,
  readStoredDismissedQuestions,
  readStoredRecoverableQuestions,
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
const questionPromptsStorageKey = "wanta:chat:question-prompts:v2"
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
    expect(dismissals.some((item) => item.requestId === dismissed.id)).toBe(true)
    expect(dismissals.some((item) => item.toolKey === recovered.tool.messageId + "\0" + recovered.tool.callId)).toBe(
      true,
    )
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

  it("stores prompt state and drafts in a single v2 prompt record", () => {
    const request = { ...question("q1"), tool: { messageId: "m1", callId: "call-1" } }

    addStoredStoppedQuestions("s1", [request])
    writeStoredQuestionDraft("s1", request, {
      activeFieldIndex: 0,
      drafts: [{ selected: [], value: "draft" }],
    })
    addStoredRecoverableQuestions("s1", [request])

    expect(readStoredStoppedQuestions("s1").map((item) => item.id)).toEqual(["q1"])
    expect(readStoredRecoverableQuestions("s1")).toEqual([])
    expect(readStoredQuestionDraft("s1", "q1", 1)?.drafts[0]?.value).toBe("draft")
    expect(JSON.parse(globalThis.localStorage.getItem(questionPromptsStorageKey) ?? "{}")).toMatchObject({
      s1: [
        {
          draft: { activeFieldIndex: 0 },
          request: { id: "q1" },
          requestId: "q1",
          state: "stopped",
          toolKey: "m1\0call-1",
        },
      ],
    })

    removeStoredStoppedQuestion("s1", "q1")
    expect(readStoredStoppedQuestions("s1")).toEqual([])
    expect(readStoredQuestionDraft("s1", "q1", 1)?.drafts[0]?.value).toBe("draft")

    addStoredRecoverableQuestions("s1", [request])
    expect(readStoredRecoverableQuestions("s1").map((item) => item.id)).toEqual(["q1"])
  })

  it("matches prompt state and drafts by tool identity when request ids change", () => {
    const original = { ...question("q1"), tool: { messageId: "m1", callId: "call-1" } }
    const recovered = { ...question("recovered:m1:call-1"), tool: { messageId: "m1", callId: "call-1" } }

    addStoredStoppedQuestions("s1", [original])
    writeStoredQuestionDraft("s1", original, {
      activeFieldIndex: 0,
      drafts: [{ selected: [], value: "tool draft" }],
    })

    expect(readStoredQuestionDraft("s1", recovered, 1)?.drafts[0]?.value).toBe("tool draft")

    removeStoredStoppedQuestion("s1", recovered)
    expect(readStoredStoppedQuestions("s1")).toEqual([])
    expect(readStoredQuestionDraft("s1", recovered, 1)?.drafts[0]?.value).toBe("tool draft")

    removeStoredQuestionDraft("s1", recovered)
    expect(readStoredQuestionDraft("s1", original, 1)).toBeNull()
  })

  it("repairs missing v2 tool keys from stored request snapshots", () => {
    const original = { ...question("q1"), tool: { messageId: "m1", callId: "call-1" } }
    const recovered = { ...question("recovered:m1:call-1"), tool: { messageId: "m1", callId: "call-1" } }
    globalThis.localStorage.setItem(
      questionPromptsStorageKey,
      JSON.stringify({
        s1: [
          {
            draft: {
              activeFieldIndex: 0,
              drafts: [{ selected: [], value: "old draft" }],
              updatedAt: Date.now(),
            },
            request: original,
            requestId: original.id,
            state: "stopped",
            updatedAt: Date.now(),
          },
        ],
      }),
    )

    expect(readStoredQuestionDraft("s1", recovered, 1)?.drafts[0]?.value).toBe("old draft")
    expect(JSON.parse(globalThis.localStorage.getItem(questionPromptsStorageKey) ?? "{}")).toMatchObject({
      s1: [{ toolKey: "m1\0call-1" }],
    })
  })

  it("migrates legacy stopped questions and drafts into v2 prompt storage", () => {
    globalThis.localStorage.setItem(
      stoppedQuestionsStorageKey,
      JSON.stringify({
        s1: [{ request: { ...question("q1"), tool: { messageId: "m1", callId: "call-1" } }, updatedAt: Date.now() }],
      }),
    )
    globalThis.localStorage.setItem(
      questionDraftsStorageKey,
      JSON.stringify({
        s1: {
          q1: {
            activeFieldIndex: 0,
            drafts: [{ selected: [], value: "legacy draft" }],
            updatedAt: Date.now(),
          },
        },
      }),
    )

    expect(readStoredStoppedQuestions("s1").map((request) => request.id)).toEqual(["q1"])
    expect(readStoredQuestionDraft("s1", "q1", 1)?.drafts[0]?.value).toBe("legacy draft")
    expect(JSON.parse(globalThis.localStorage.getItem(questionPromptsStorageKey) ?? "{}")).toMatchObject({
      s1: [
        {
          draft: { activeFieldIndex: 0 },
          request: { id: "q1" },
          requestId: "q1",
          state: "stopped",
          toolKey: "m1\0call-1",
        },
      ],
    })
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
