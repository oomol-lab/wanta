import type { ChatQuestionInfo, ChatQuestionOption, ChatQuestionRequest } from "../../../electron/chat/common.ts"

export type QuestionFieldKind = "text" | "email" | "textarea"

export interface QuestionFieldOption extends ChatQuestionOption {
  manual?: boolean
  value: string
}

export interface QuestionField {
  id: string
  questionIndex: number
  label: string
  prompt?: string
  kind: QuestionFieldKind
  value: string
  options: QuestionFieldOption[]
}

export interface QuestionFieldDraft {
  value: string
  selected: string[]
}

export interface QuestionDraftSnapshot {
  activeFieldIndex: number
  drafts: QuestionFieldDraft[]
}

export interface QuestionDraftStore {
  read: (sessionId: string, request: ChatQuestionRequest, expectedDraftCount: number) => QuestionDraftSnapshot | null
  remove: (sessionId: string, request: ChatQuestionRequest) => void
  write: (sessionId: string, request: ChatQuestionRequest, snapshot: QuestionDraftSnapshot) => void
}

const numberedQuestionPattern = /(?:^|[\s。；;，,])\d+[.．、]\s*([^?？。；;]+[?？]?)/g
const knownBodyPattern =
  /(?:正文|邮件正文|生成内容|内容)[^。；;?？]*(?:已确定为|确定为|设为|设置为|为|是)\s*[：:]?\s*[「“"]([^」”"]+)[」”"]/i
const fieldKeywordPattern = /收件人|邮箱|email|recipient|\bto\b|主题|subject|正文|邮件内容|生成内容|内容|message|body/i
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

function cleanQuestionText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function stripQuestionWords(value: string): string {
  return cleanQuestionText(value)
    .replace(/^[请问\s]+/, "")
    .replace(/^(填写|输入|提供|补充|指定|设置|完善)/, "")
    .replace(/[?？。；;]+$/g, "")
    .replace(/(?:是什么|是啥|填写什么|填什么|输入什么|是多少|为多少|怎么处理|如何处理)$/g, "")
    .trim()
}

function inferFieldLabel(prompt: string, header?: string): string {
  const compact = stripQuestionWords(header ?? "") || stripQuestionWords(prompt)
  const lower = compact.toLowerCase()
  if (/收件人|recipient|\bto\b/.test(lower)) {
    return "收件人"
  }
  if (/邮箱|email|mail address/.test(lower)) {
    return "邮箱地址"
  }
  if (/主题|subject/.test(lower)) {
    return "主题"
  }
  if (/正文|邮件内容|生成内容|内容|message|body/.test(lower)) {
    return "正文"
  }
  return compact || "回答"
}

function inferFieldKind(label: string, prompt: string): QuestionFieldKind {
  const text = `${label} ${prompt}`.toLowerCase()
  if (/收件人|邮箱|email|recipient|\bto\b|mail address/.test(text)) {
    return "email"
  }
  if (/正文|邮件内容|生成内容|内容|message|body|description|描述/.test(text)) {
    return "textarea"
  }
  return "text"
}

function isManualOption(option: ChatQuestionOption): boolean {
  const text = `${option.label} ${option.description ?? ""}`.toLowerCase()
  return /(自定义|自己指定|自己填写|手动输入|提供信息|我来提供|输入其他|其他邮箱|其他主题|custom|other)/.test(text)
}

function fieldOptionForQuestion(kind: QuestionFieldKind, option: ChatQuestionOption): QuestionFieldOption | null {
  if (isManualOption(option)) {
    return { ...option, manual: true, value: "" }
  }
  if (isFieldPromptOption(option)) {
    return null
  }
  if (kind === "email") {
    const value = option.label.match(emailPattern)?.[0] ?? option.description?.match(emailPattern)?.[0]
    return value ? { ...option, value } : null
  }
  const value = cleanQuestionText(option.label)
  return value ? { ...option, value } : null
}

function usefulOptions(kind: QuestionFieldKind, question: ChatQuestionInfo): QuestionFieldOption[] {
  const options = question.options.flatMap((option) => {
    const text = `${option.label} ${option.description ?? ""}`.toLowerCase()
    if (!text.trim()) {
      return []
    }
    const fieldOption = fieldOptionForQuestion(kind, option)
    return fieldOption ? [fieldOption] : []
  })
  return options.length === 1 && options[0].manual ? [] : options
}

function isFieldPromptOption(option: ChatQuestionOption): boolean {
  const label = cleanQuestionText(option.label)
  if (!fieldKeywordPattern.test(label)) {
    return false
  }
  return /^(填写|输入|提供|补充|指定|设置|完善)/.test(label) || /是什么|填什么|输入什么|提供/.test(label)
}

function extractOptionFieldPrompts(options: ChatQuestionOption[]): string[] {
  return options
    .filter((option) => !isManualOption(option) && isFieldPromptOption(option))
    .map((option) => option.label)
}

function extractNumberedPrompts(question: string): string[] {
  const prompts: string[] = []
  for (const match of question.matchAll(numberedQuestionPattern)) {
    const prompt = cleanQuestionText(match[1] ?? "")
    if (prompt) {
      prompts.push(prompt)
    }
  }
  return prompts
}

function extractKnownBody(question: string): string | null {
  return cleanQuestionText(question.match(knownBodyPattern)?.[1] ?? "") || null
}

function createField(
  requestId: string,
  questionIndex: number,
  prompt: string,
  options: ChatQuestionOption[],
  value = "",
  header?: string,
): QuestionField {
  const label = inferFieldLabel(prompt, header)
  const kind = inferFieldKind(label, prompt)
  return {
    id: `${requestId}:${questionIndex}:${label}:${prompt}`,
    questionIndex,
    label,
    prompt: stripQuestionWords(prompt) === label ? undefined : cleanQuestionText(prompt),
    kind,
    value,
    options: options.flatMap((option) => {
      const fieldOption = fieldOptionForQuestion(kind, option)
      return fieldOption ? [fieldOption] : []
    }),
  }
}

function fieldsForQuestion(requestId: string, question: ChatQuestionInfo, questionIndex: number): QuestionField[] {
  const prompts = extractNumberedPrompts(question.question)
  const fallback = createField(requestId, questionIndex, question.question, [], "", question.header)
  const fallbackOptions = usefulOptions(fallback.kind, question)
  const optionPrompts = fallbackOptions.length > 0 ? [] : extractOptionFieldPrompts(question.options)
  const fields =
    prompts.length > 0 ? prompts.map((prompt) => createField(requestId, questionIndex, prompt, [], "")) : []
  const knownBody = extractKnownBody(question.question)

  if (knownBody && !fields.some((field) => field.kind === "textarea")) {
    fields.push(createField(requestId, questionIndex, "正文", [], knownBody))
  }

  if (fields.length > 0) {
    return dedupeFields(fields)
  }

  if (optionPrompts.length > 0) {
    return dedupeFields(optionPrompts.map((prompt) => createField(requestId, questionIndex, prompt, [], "")))
  }

  return [{ ...fallback, options: fallbackOptions }]
}

export function deriveQuestionFields(request: ChatQuestionRequest): QuestionField[] {
  return request.questions.flatMap((question, index) => fieldsForQuestion(request.id, question, index))
}

function dedupeFields(fields: QuestionField[]): QuestionField[] {
  const seen = new Set<string>()
  return fields.filter((field) => {
    const key = `${field.kind}:${field.label}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function initialFieldDrafts(fields: QuestionField[]): QuestionFieldDraft[] {
  return fields.map((field) => ({ value: field.value, selected: [] }))
}

function fieldDraftsEqual(left: QuestionFieldDraft, right: QuestionFieldDraft): boolean {
  return (
    left.value === right.value &&
    left.selected.length === right.selected.length &&
    left.selected.every((item, index) => item === right.selected[index])
  )
}

export function isQuestionDraftSnapshotPristine(
  snapshot: QuestionDraftSnapshot,
  initialDrafts: QuestionFieldDraft[],
): boolean {
  return (
    snapshot.activeFieldIndex === 0 &&
    snapshot.drafts.length === initialDrafts.length &&
    snapshot.drafts.every((draft, index) =>
      fieldDraftsEqual(draft, initialDrafts[index] ?? { value: "", selected: [] }),
    )
  )
}

export function fieldDraftValue(field: QuestionField, draft: QuestionFieldDraft): string {
  const selected = draft.selected[0]
  const selectedOption = selected ? field.options.find((option) => option.label === selected) : undefined
  if (selectedOption?.manual) {
    return draft.value.trim()
  }
  if (selectedOption) {
    return selectedOption.value.trim() || selectedOption.label.trim()
  }
  return draft.value.trim()
}

export function canSubmitFieldAnswers(fields: QuestionField[], drafts: QuestionFieldDraft[]): boolean {
  return fields.every((field, index) => fieldDraftValue(field, drafts[index] ?? { value: "", selected: [] }))
}

export function answersFromFieldDrafts(
  request: ChatQuestionRequest,
  fields: QuestionField[],
  drafts: QuestionFieldDraft[],
): string[][] {
  return request.questions.map((_, questionIndex) => {
    const questionFields = fields.filter((field) => field.questionIndex === questionIndex)
    if (questionFields.length === 1) {
      const fieldIndex = fields.indexOf(questionFields[0])
      return [fieldDraftValue(questionFields[0], drafts[fieldIndex] ?? { value: "", selected: [] })].filter(Boolean)
    }
    const answer = questionFields
      .map((field) => {
        const fieldIndex = fields.indexOf(field)
        const value = fieldDraftValue(field, drafts[fieldIndex] ?? { value: "", selected: [] })
        return value ? `${field.label}: ${value}` : ""
      })
      .filter(Boolean)
      .join("\n")
    return answer ? [answer] : []
  })
}
