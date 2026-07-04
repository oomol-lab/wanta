import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

function questionLabel(request: ChatQuestionRequest, questionIndex: number): string {
  const question = request.questions[questionIndex]
  const text = question?.question.trim() || question?.header.trim()
  return text || `Question ${questionIndex + 1}`
}

export function formatQuestionResumeMessage(t: TranslateFn, request: ChatQuestionRequest, answers: string[][]): string {
  const items = answers.flatMap((answer, index) => {
    const answerText = answer
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n")
    if (!answerText) {
      return []
    }
    return [
      t("chat.questionResumeMessageItem", {
        answer: answerText,
        question: questionLabel(request, index),
      }),
    ]
  })
  return t("chat.questionResumeMessage", {
    answers: items.length > 0 ? items.join("\n\n") : t("chat.questionResumeMessageEmpty"),
  })
}
