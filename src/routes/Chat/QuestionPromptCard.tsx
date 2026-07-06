import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { QuestionField, QuestionFieldDraft, QuestionFieldOption } from "./question-fields.ts"
import type { ChatQuestionState } from "./question-state.ts"

import { Check } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  answersFromFieldDrafts,
  canSubmitFieldAnswers,
  deriveQuestionFields,
  initialFieldDrafts,
} from "./question-fields.ts"
import { readStoredQuestionDraft, removeStoredQuestionDraft, writeStoredQuestionDraft } from "./question-persistence.ts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

interface QuestionPromptCardProps {
  request: ChatQuestionRequest
  state?: ChatQuestionState
  busy?: boolean
  onAnswer: (requestId: string, answers: string[][]) => Promise<void>
  continueDisabled?: boolean
  onContinue: (request: ChatQuestionRequest, answers: string[][]) => Promise<void>
  onDiscard: (requestId: string) => void
  onReject: (requestId: string) => Promise<void>
}

const customOptionValue = "__custom__"
const questionControlClassName =
  "border-[var(--oo-control-border)] shadow-none focus-visible:border-[var(--input-focus-ring)] focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_var(--input-focus-ring)]"

function placeholderForField(t: ReturnType<typeof useT>, field: QuestionField): string {
  if (field.kind === "email") {
    return t("chat.questionEmailPlaceholder")
  }
  if (field.kind === "textarea") {
    return t("chat.questionTextareaPlaceholder")
  }
  return t("chat.questionTextPlaceholder", { label: field.label })
}

function chooseOption(draft: QuestionFieldDraft, option: QuestionFieldOption): QuestionFieldDraft {
  const selected = draft.selected[0] === option.label ? [] : [option.label]
  return { selected, value: selected.length > 0 && !option.manual ? option.value : "" }
}

function chooseCustomOption(draft: QuestionFieldDraft): QuestionFieldDraft {
  const selected = draft.selected[0] === customOptionValue ? [] : [customOptionValue]
  return { selected, value: selected.length > 0 ? draft.value : "" }
}

function optionInlineDescription(label: string, description: string | undefined): string | null {
  const text = description?.trim()
  if (!text) {
    return null
  }
  const normalizedLabel = label.replace(/[「」“”"'`\s]/g, "")
  const normalizedDescription = text.replace(/[「」“”"'`\s]/g, "")
  if (normalizedDescription === normalizedLabel || normalizedDescription.includes(`设为${normalizedLabel}`)) {
    return null
  }
  if (
    normalizedDescription.includes(`使用${normalizedLabel}`) ||
    normalizedDescription.includes(`${normalizedLabel}作为`)
  ) {
    return null
  }
  return text
}

function QuestionChoiceRow({
  description,
  disabled,
  label,
  selected,
  onSelect,
}: {
  description?: string
  disabled: boolean
  label: string
  selected: boolean
  onSelect: () => void
}) {
  const inlineDescription = optionInlineDescription(label, description)
  return (
    <button
      type="button"
      title={description || label}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-md border px-2.5 py-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-ring bg-muted text-foreground"
          : "border-border/80 bg-background text-foreground hover:bg-muted/60",
      )}
      onClick={onSelect}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50",
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="size-3" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="oo-text-label min-w-0 truncate font-medium">{label}</span>
        {inlineDescription ? (
          <>
            <span className="shrink-0 text-muted-foreground/60">·</span>
            <span className="oo-text-caption-compact min-w-0 truncate text-muted-foreground">{inlineDescription}</span>
          </>
        ) : null}
      </span>
    </button>
  )
}

function QuestionStepIndicator({
  activeIndex,
  disabled,
  drafts,
  fields,
  onSelect,
}: {
  activeIndex: number
  disabled: boolean
  drafts: QuestionFieldDraft[]
  fields: QuestionField[]
  onSelect: (index: number) => void
}) {
  return (
    <ol className="inline-flex max-w-full flex-wrap items-center gap-1 border-b border-border" role="tablist">
      {fields.map((field, index) => {
        const answered = canSubmitFieldAnswers([field], [drafts[index] ?? { value: "", selected: [] }])
        const active = index === activeIndex
        return (
          <li key={field.id} className="min-w-0">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              className={cn(
                "flex min-w-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-foreground text-foreground"
                  : answered
                    ? "border-transparent text-foreground hover:border-muted-foreground/40"
                    : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
              )}
              onClick={() => onSelect(index)}
            >
              <span
                className={cn(
                  "oo-text-micro flex size-4 shrink-0 items-center justify-center rounded-full border font-medium",
                  active
                    ? "border-foreground text-foreground"
                    : answered
                      ? "border-muted-foreground/50 text-foreground"
                      : "border-border text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <span className="oo-text-label min-w-0 truncate">{field.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function QuestionPromptCard({
  request,
  state = "active",
  busy = false,
  continueDisabled = false,
  onAnswer,
  onContinue,
  onDiscard,
  onReject,
}: QuestionPromptCardProps) {
  const t = useT()
  const fields = React.useMemo(() => deriveQuestionFields(request), [request])
  const initialDraftSnapshot = React.useMemo(
    () => readStoredQuestionDraft(request.sessionId, request.id, fields.length),
    [fields.length, request.id, request.sessionId],
  )
  const [drafts, setDrafts] = React.useState<QuestionFieldDraft[]>(
    () => initialDraftSnapshot?.drafts ?? initialFieldDrafts(fields),
  )
  const [activeFieldIndex, setActiveFieldIndex] = React.useState(initialDraftSnapshot?.activeFieldIndex ?? 0)
  const [submitting, setSubmitting] = React.useState<"answer" | "discard" | "reject" | null>(null)
  const draftsRef = React.useRef(drafts)
  const activeControlRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const previousActiveFieldIndexRef = React.useRef(activeFieldIndex)
  const disabled = busy || Boolean(submitting)
  const isStopped = state === "stopped"
  const canSubmit = canSubmitFieldAnswers(fields, drafts)
  const activeField = fields[activeFieldIndex]
  const activeDraft = drafts[activeFieldIndex] ?? { value: "", selected: [] }
  const canContinue = activeField ? canSubmitFieldAnswers([activeField], [activeDraft]) : false
  const isLastStep = activeFieldIndex >= fields.length - 1

  React.useEffect(() => {
    const stored = readStoredQuestionDraft(request.sessionId, request.id, fields.length)
    const nextDrafts = stored?.drafts ?? initialFieldDrafts(fields)
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
    setActiveFieldIndex(stored?.activeFieldIndex ?? 0)
    setSubmitting(null)
  }, [fields, request.id, request.sessionId])

  React.useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  React.useEffect(() => {
    writeStoredQuestionDraft(request.sessionId, request.id, { activeFieldIndex, drafts })
  }, [activeFieldIndex, drafts, request.id, request.sessionId])

  const persistDrafts = React.useCallback(
    (nextActiveFieldIndex: number, nextDrafts: QuestionFieldDraft[]) => {
      writeStoredQuestionDraft(request.sessionId, request.id, {
        activeFieldIndex: nextActiveFieldIndex,
        drafts: nextDrafts,
      })
    },
    [request.id, request.sessionId],
  )

  React.useEffect(() => {
    if (activeFieldIndex >= fields.length) {
      setActiveFieldIndex(0)
    }
  }, [activeFieldIndex, fields.length])

  React.useLayoutEffect(() => {
    if (previousActiveFieldIndexRef.current === activeFieldIndex) {
      return
    }
    previousActiveFieldIndexRef.current = activeFieldIndex
    activeControlRef.current?.focus()
  }, [activeFieldIndex])

  const setActiveControlRef = React.useCallback((node: HTMLInputElement | HTMLTextAreaElement | null) => {
    activeControlRef.current = node
  }, [])

  const updateDraft = React.useCallback(
    (index: number, updater: (draft: QuestionFieldDraft) => QuestionFieldDraft) => {
      setDrafts((current) => {
        const next = current.map((draft, draftIndex) => (draftIndex === index ? updater(draft) : draft))
        draftsRef.current = next
        persistDrafts(activeFieldIndex, next)
        return next
      })
    },
    [activeFieldIndex, persistDrafts],
  )

  const selectActiveFieldIndex = React.useCallback(
    (nextIndex: number) => {
      const normalizedIndex = Math.min(Math.max(nextIndex, 0), Math.max(0, fields.length - 1))
      persistDrafts(normalizedIndex, draftsRef.current)
      setActiveFieldIndex(normalizedIndex)
    },
    [fields.length, persistDrafts],
  )

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit || disabled || (isStopped && continueDisabled)) {
      return
    }
    setSubmitting("answer")
    try {
      const answers = answersFromFieldDrafts(request, fields, drafts)
      if (isStopped) {
        await onContinue(request, answers)
      } else {
        await onAnswer(request.id, answers)
      }
      removeStoredQuestionDraft(request.sessionId, request.id)
    } catch (err) {
      reportRendererHandledError("chat", isStopped ? "question continue failed" : "question answer failed", err)
      toast.error(isStopped ? t("chat.questionContinueFailed") : t("chat.questionSubmitFailed"))
    } finally {
      setSubmitting(null)
    }
  }, [canSubmit, continueDisabled, disabled, drafts, fields, isStopped, onAnswer, onContinue, request, t])

  const handleReject = React.useCallback(async () => {
    if (disabled) {
      return
    }
    if (isStopped) {
      setSubmitting("discard")
      try {
        onDiscard(request.id)
        removeStoredQuestionDraft(request.sessionId, request.id)
      } finally {
        setSubmitting(null)
      }
      return
    }
    setSubmitting("reject")
    try {
      await onReject(request.id)
      removeStoredQuestionDraft(request.sessionId, request.id)
    } catch (err) {
      reportRendererHandledError("chat", "question reject failed", err)
      toast.error(t("chat.questionCancelFailed"))
    } finally {
      setSubmitting(null)
    }
  }, [disabled, isStopped, onDiscard, onReject, request.id, request.sessionId, t])

  const handleNext = React.useCallback(() => {
    if (!canContinue || disabled || isLastStep) {
      return
    }
    selectActiveFieldIndex(activeFieldIndex + 1)
  }, [activeFieldIndex, canContinue, disabled, isLastStep, selectActiveFieldIndex])

  const handlePrevious = React.useCallback(() => {
    if (disabled) {
      return
    }
    selectActiveFieldIndex(activeFieldIndex - 1)
  }, [activeFieldIndex, disabled, selectActiveFieldIndex])

  return (
    <form
      className="not-prose rounded-lg border border-border/80 bg-background px-4 py-4 shadow-xs"
      onSubmit={(event) => {
        event.preventDefault()
        if (fields.length > 1 && !isLastStep) {
          handleNext()
          return
        }
        void handleSubmit()
      }}
    >
      <div className="space-y-4">
        {isStopped ? (
          <div className="rounded-md border border-border/80 bg-muted/35 px-3 py-2.5">
            <div className="oo-text-label font-medium text-foreground">{t("chat.questionStoppedStatus")}</div>
            <div className="oo-text-caption mt-0.5 text-muted-foreground">
              {continueDisabled ? t("chat.questionStoppedBusyHint") : t("chat.questionStoppedHint")}
            </div>
          </div>
        ) : null}

        {fields.length > 1 ? (
          <QuestionStepIndicator
            activeIndex={activeFieldIndex}
            disabled={disabled}
            drafts={drafts}
            fields={fields}
            onSelect={selectActiveFieldIndex}
          />
        ) : null}

        {fields.map((field, index) => {
          if (fields.length > 1 && index !== activeFieldIndex) {
            return null
          }
          const draft = drafts[index] ?? { value: "", selected: [] }
          const inputId = `${request.id}-${index}-field`
          const selectedOption = field.options.find((option) => option.label === draft.selected[0])
          const hasConcreteOptions = field.options.some((option) => !option.manual)
          const shouldRenderCustomOption = hasConcreteOptions && !field.options.some((option) => option.manual)
          const showInput =
            field.options.length === 0 || draft.selected[0] === customOptionValue || Boolean(selectedOption?.manual)
          const options = [
            ...field.options.filter((option) => !option.manual),
            ...field.options.filter((option) => option.manual),
          ]
          const spaciousField = field.options.length > 0 || field.kind === "textarea"
          return (
            <fieldset
              key={field.id}
              className={cn("space-y-2.5", spaciousField ? "max-h-64 min-h-28 overflow-y-auto pr-1" : "min-h-0")}
            >
              <Label
                htmlFor={inputId}
                className={cn("oo-text-label block font-semibold text-foreground", fields.length > 1 && "sr-only")}
              >
                {fields.length > 1 ? `${index + 1}. ${field.label}` : field.label}
              </Label>

              {field.options.length > 0 ? (
                <div className="grid w-full grid-cols-1 gap-2">
                  {options.map((option) => (
                    <QuestionChoiceRow
                      key={option.label}
                      label={option.manual ? t("chat.questionCustomOption") : option.label}
                      description={option.manual ? undefined : option.description}
                      disabled={disabled}
                      selected={draft.selected.includes(option.label)}
                      onSelect={() => updateDraft(index, (current) => chooseOption(current, option))}
                    />
                  ))}
                  {shouldRenderCustomOption ? (
                    <QuestionChoiceRow
                      label={t("chat.questionCustomOption")}
                      disabled={disabled}
                      selected={draft.selected[0] === customOptionValue}
                      onSelect={() => updateDraft(index, chooseCustomOption)}
                    />
                  ) : null}
                </div>
              ) : null}

              {showInput ? (
                field.kind === "textarea" ? (
                  <Textarea
                    ref={setActiveControlRef}
                    id={inputId}
                    value={draft.value}
                    disabled={disabled}
                    placeholder={placeholderForField(t, field)}
                    className={cn("min-h-24 resize-y", questionControlClassName)}
                    onChange={(event) =>
                      updateDraft(index, (current) => ({ value: event.target.value, selected: current.selected }))
                    }
                  />
                ) : (
                  <Input
                    ref={setActiveControlRef}
                    id={inputId}
                    type={field.kind === "email" ? "email" : "text"}
                    value={draft.value}
                    disabled={disabled}
                    placeholder={placeholderForField(t, field)}
                    className={questionControlClassName}
                    onChange={(event) =>
                      updateDraft(index, (current) => ({ value: event.target.value, selected: current.selected }))
                    }
                  />
                )
              ) : null}
            </fieldset>
          )
        })}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5"
            disabled={disabled}
            onClick={handleReject}
          >
            {submitting === "reject" || submitting === "discard"
              ? t("chat.questionCancelling")
              : isStopped
                ? t("chat.questionDiscard")
                : t("chat.questionCancel")}
          </Button>
          {fields.length > 1 && activeFieldIndex > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2.5"
              disabled={disabled}
              onClick={handlePrevious}
            >
              {t("chat.questionPrevious")}
            </Button>
          ) : null}
          {fields.length > 1 && !isLastStep ? (
            <Button
              type="button"
              size="sm"
              className="h-8 px-2.5"
              disabled={!canContinue || disabled}
              onClick={handleNext}
            >
              {t("chat.questionNext")}
            </Button>
          ) : (
            <Button
              size="sm"
              type="submit"
              className="h-8 px-2.5"
              disabled={!canSubmit || disabled || (isStopped && continueDisabled)}
            >
              {submitting === "answer"
                ? t("chat.questionSubmitting")
                : isStopped
                  ? t("chat.questionContinue")
                  : t("chat.questionSubmit")}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
