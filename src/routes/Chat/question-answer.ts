import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"

export function isSingleTextQuestion(request: ChatQuestionRequest): boolean {
  return request.questions.length === 1 && request.questions[0]?.options.length === 0
}

export function answerSingleTextQuestion(request: ChatQuestionRequest, value: string): string[][] {
  const answer = value.trim()
  return request.questions.map(() => (answer ? [answer] : []))
}
