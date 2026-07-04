import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { QuestionField, QuestionFieldDraft, QuestionFieldOption } from "./question-fields.ts"

import { Check } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  answersFromFieldDrafts,
  canSubmitFieldAnswers,
  deriveQuestionFields,
  initialFieldDrafts,
} from "./question-fields.ts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

interface QuestionPromptCardProps {
  request: ChatQuestionRequest
  busy?: boolean
  onAnswer: (requestId: string, answers: string[][]) => Promise<void>
  onReject: (requestId: string) => Promise<void>
}

const customOptionValue = "__custom__"

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

export function QuestionPromptCard({ request, busy = false, onAnswer, onReject }: QuestionPromptCardProps) {
  const t = useT()
  const fields = React.useMemo(() => deriveQuestionFields(request), [request])
  const [drafts, setDrafts] = React.useState<QuestionFieldDraft[]>(() => initialFieldDrafts(fields))
  const [activeFieldIndex, setActiveFieldIndex] = React.useState(0)
  const [submitting, setSubmitting] = React.useState<"answer" | "reject" | null>(null)
  const activeControlRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const previousActiveFieldIndexRef = React.useRef(activeFieldIndex)
  const disabled = busy || Boolean(submitting)
  const canSubmit = canSubmitFieldAnswers(fields, drafts)
  const activeField = fields[activeFieldIndex]
  const activeDraft = drafts[activeFieldIndex] ?? { value: "", selected: [] }
  const canContinue = activeField ? canSubmitFieldAnswers([activeField], [activeDraft]) : false
  const isLastStep = activeFieldIndex >= fields.length - 1

  React.useEffect(() => {
    setDrafts(initialFieldDrafts(fields))
    setActiveFieldIndex(0)
    setSubmitting(null)
  }, [fields, request.id])

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

  const updateDraft = React.useCallback((index: number, updater: (draft: QuestionFieldDraft) => QuestionFieldDraft) => {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? updater(draft) : draft)))
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit || disabled) {
      return
    }
    setSubmitting("answer")
    try {
      await onAnswer(request.id, answersFromFieldDrafts(request, fields, drafts))
    } catch (err) {
      reportRendererHandledError("chat", "question answer failed", err)
      toast.error(t("chat.questionSubmitFailed"))
    } finally {
      setSubmitting(null)
    }
  }, [canSubmit, disabled, drafts, fields, onAnswer, request, t])

  const handleReject = React.useCallback(async () => {
    if (disabled) {
      return
    }
    setSubmitting("reject")
    try {
      await onReject(request.id)
    } catch (err) {
      reportRendererHandledError("chat", "question reject failed", err)
      toast.error(t("chat.questionCancelFailed"))
    } finally {
      setSubmitting(null)
    }
  }, [disabled, onReject, request.id, t])

  const handleNext = React.useCallback(() => {
    if (!canContinue || disabled || isLastStep) {
      return
    }
    setActiveFieldIndex((index) => Math.min(index + 1, fields.length - 1))
  }, [canContinue, disabled, fields.length, isLastStep])

  const handlePrevious = React.useCallback(() => {
    if (disabled) {
      return
    }
    setActiveFieldIndex((index) => Math.max(index - 1, 0))
  }, [disabled])

  return (
    <form
      className="not-prose rounded-lg border border-border/80 bg-background px-4 py-3 shadow-xs"
      onSubmit={(event) => {
        event.preventDefault()
        if (fields.length > 1 && !isLastStep) {
          handleNext()
          return
        }
        void handleSubmit()
      }}
    >
      <div className="space-y-3">
        {fields.length > 1 ? (
          <QuestionStepIndicator
            activeIndex={activeFieldIndex}
            disabled={disabled}
            drafts={drafts}
            fields={fields}
            onSelect={setActiveFieldIndex}
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
          return (
            <fieldset key={field.id} className="max-h-64 min-h-28 space-y-1.5 overflow-y-auto pr-1">
              <Label
                htmlFor={inputId}
                className={cn("oo-text-label font-semibold text-foreground", fields.length > 1 && "sr-only")}
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
                    className="min-h-20 resize-y"
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
                    className="h-8"
                    onChange={(event) =>
                      updateDraft(index, (current) => ({ value: event.target.value, selected: current.selected }))
                    }
                  />
                )
              ) : null}
            </fieldset>
          )
        })}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5"
            disabled={disabled}
            onClick={handleReject}
          >
            {submitting === "reject" ? t("chat.questionCancelling") : t("chat.questionCancel")}
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
            <Button size="sm" type="submit" className="h-8 px-2.5" disabled={!canSubmit || disabled}>
              {submitting === "answer" ? t("chat.questionSubmitting") : t("chat.questionSubmit")}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
