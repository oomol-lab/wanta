import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  addStoredStoppedQuestions,
  mergePendingQuestionsWithStopped,
  readStoredQuestionDraft,
  readStoredStoppedQuestions,
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
const questionDraftsStorageKey = "wanta:chat:question-drafts:v1"
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

  it("prunes expired stopped questions and drafts during reads", () => {
    globalThis.localStorage.setItem(
      stoppedQuestionsStorageKey,
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

    expect(readStoredStoppedQuestions("s1")).toEqual([])
    expect(readStoredQuestionDraft("s1", "q1", 1)).toBeNull()
  })
})
