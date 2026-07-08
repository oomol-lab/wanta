import type { ChatQuestionInfo, ChatQuestionOption, ChatQuestionRequest } from "../../../electron/chat/common.ts"

function cleanQuestionText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeQuestionOption(value: unknown): ChatQuestionOption | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const option = value as { label?: unknown; description?: unknown }
  if (typeof option.label !== "string" || !option.label.trim()) {
    return null
  }
  return {
    label: option.label,
    ...(typeof option.description === "string" && option.description.trim() ? { description: option.description } : {}),
  }
}

export function normalizeQuestionInfo(value: unknown): ChatQuestionInfo | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const question = value as {
    custom?: unknown
    header?: unknown
    multiple?: unknown
    options?: unknown
    question?: unknown
  }
  if (typeof question.question !== "string" || !question.question.trim()) {
    return null
  }
  const header =
    typeof question.header === "string" && question.header.trim()
      ? question.header.trim()
      : cleanQuestionText(question.question)
  return {
    question: question.question,
    header,
    options: Array.isArray(question.options)
      ? question.options
          .map(normalizeQuestionOption)
          .filter((option): option is NonNullable<typeof option> => Boolean(option))
      : [],
    ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
    ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
  }
}

export function normalizeQuestionRequest(value: unknown): ChatQuestionRequest | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const request = value as {
    id?: unknown
    questions?: unknown
    sessionId?: unknown
    tool?: { callId?: unknown; messageId?: unknown }
  }
  if (typeof request.id !== "string" || typeof request.sessionId !== "string" || !Array.isArray(request.questions)) {
    return null
  }
  const questions = request.questions
    .map(normalizeQuestionInfo)
    .filter((question): question is NonNullable<typeof question> => Boolean(question))
  if (questions.length === 0) {
    return null
  }
  const messageId = request.tool?.messageId
  const callId = request.tool?.callId
  return {
    id: request.id,
    sessionId: request.sessionId,
    questions,
    ...(typeof messageId === "string" && typeof callId === "string" ? { tool: { messageId, callId } } : {}),
  }
}
