import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { describe, expect, it } from "vitest"
import { formatQuestionResumeMessage } from "./question-resume-message.ts"

const t: TranslateFn = (key, values) => {
  if (key === "chat.questionResumeMessage") {
    return `Continue:\n${String(values?.answers ?? "")}`
  }
  if (key === "chat.questionResumeMessageItem") {
    return `- ${String(values?.question ?? "")}\n  ${String(values?.answer ?? "")}`
  }
  if (key === "chat.questionResumeMessageEmpty") {
    return "No answers"
  }
  return key
}

describe("question resume message", () => {
  it("includes original question labels with answers", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [
        { header: "收件人", question: "收件人邮箱地址是什么？", options: [] },
        { header: "主题", question: "邮件主题是什么？", options: [] },
      ],
    }

    expect(formatQuestionResumeMessage(t, request, [["foo@example.com"], ["测试连接"]])).toBe(
      "Continue:\n- 收件人邮箱地址是什么？\n  foo@example.com\n\n- 邮件主题是什么？\n  测试连接",
    )
  })

  it("uses a fallback message when no answers are filled", () => {
    const request: ChatQuestionRequest = {
      id: "q1",
      sessionId: "s1",
      questions: [{ header: "回答", question: "请输入回答", options: [] }],
    }

    expect(formatQuestionResumeMessage(t, request, [[]])).toBe("Continue:\nNo answers")
  })
})
