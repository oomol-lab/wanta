import { describe, expect, it } from "vitest"
import { normalizeQuestionInfo, normalizeQuestionRequest } from "./question-request-normalization.ts"

describe("question request normalization", () => {
  it("normalizes question info and filters invalid options", () => {
    expect(
      normalizeQuestionInfo({
        custom: true,
        multiple: false,
        options: [{ label: "A", description: "Alpha" }, { label: "" }, null],
        question: "  Pick one  ",
      }),
    ).toEqual({
      custom: true,
      header: "Pick one",
      multiple: false,
      options: [{ label: "A", description: "Alpha" }],
      question: "  Pick one  ",
    })
  })

  it("normalizes request tool identity only when both ids are present", () => {
    expect(
      normalizeQuestionRequest({
        id: "q1",
        sessionId: "s1",
        questions: [{ question: "Answer?", options: [] }],
        tool: { messageId: "m1", callId: "call-1" },
      }),
    ).toEqual({
      id: "q1",
      sessionId: "s1",
      questions: [{ header: "Answer?", question: "Answer?", options: [] }],
      tool: { messageId: "m1", callId: "call-1" },
    })

    expect(
      normalizeQuestionRequest({
        id: "q1",
        sessionId: "s1",
        questions: [{ question: "Answer?", options: [] }],
        tool: { messageId: "m1" },
      }),
    ).toEqual({
      id: "q1",
      sessionId: "s1",
      questions: [{ header: "Answer?", question: "Answer?", options: [] }],
    })
  })

  it("rejects requests with no valid questions", () => {
    expect(normalizeQuestionRequest({ id: "q1", sessionId: "s1", questions: [{ options: [] }] })).toBeNull()
  })
})
