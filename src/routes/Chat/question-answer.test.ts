import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { isSingleTextQuestion } from "./question-answer.ts"

describe("question-answer", () => {
  it("only treats single questions without options as direct text answers", () => {
    const baseRequest: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [{ header: "回答", question: "请输入回答", options: [] }],
    }

    expect(isSingleTextQuestion(baseRequest)).toBe(true)
    expect(
      isSingleTextQuestion({
        ...baseRequest,
        questions: [{ header: "回答", question: "请选择回答", options: [{ label: "选项 A" }] }],
      }),
    ).toBe(false)
  })
})
