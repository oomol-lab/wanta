import type {
  AgentPermissionMode,
  ChatContextMention,
  ChatMessage,
  ChatTeamSkillContext,
  ChatQuestionRequest,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"
import type { ChatTurnState } from "./chat-turn-state.ts"
import type { ComposerState } from "./composer-state.ts"
import type { ArtifactSelection } from "./GeneratedArtifacts.tsx"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { ChatSendRequest, ChatSendResult } from "@/components/app-shell/app-shell-model"
import type { QueuedChatMessage, QueuedMessageMovePlacement } from "@/components/app-shell/chat-queue"
import type { UserFacingError } from "@/lib/user-facing-error"

import { Bug, X } from "lucide-react"
import * as React from "react"
import { AddCustomModelDialog } from "./AddCustomModelDialog.tsx"
import { AttachmentList } from "./ChatAttachments.tsx"
import {
  appendStoredComposerHistory,
  buildComposerHistory,
  mergeComposerHistories,
  navigateComposerHistory,
  readStoredComposerHistory,
} from "./composer-history.ts"
import { composerPaletteItemElementId } from "./composer-palette-accessibility.ts"
import {
  buildArtifactPaletteItems,
  buildConnectionPaletteItems,
  buildContextPaletteItems,
  buildKnowledgePaletteItems,
  buildSkillPaletteItems,
  slashCommandItems,
} from "./composer-palette-items.ts"
import {
  composerReducer,
  composerSubmissionText,
  hasComposerDraftContent,
  initialComposerState,
} from "./composer-state.ts"
import { ComposerAttachmentMenu } from "./ComposerAttachmentMenu.tsx"
import { ComposerPalette } from "./ComposerPalette.tsx"
import { ComposerTrailingControls } from "./ComposerTrailingControls.tsx"
import { buildContextUsageInfo } from "./context-usage.ts"
import { ContextMentionChips } from "./ContextMentionChips.tsx"
import { answerSingleTextQuestion, isSingleTextQuestion } from "./question-answer.ts"
import { QueuedMessagePanel } from "./QueuedMessagePanel.tsx"
import { normalizeServiceSlug } from "./tool-display.ts"
import { stripDraftAttachment, useComposerAttachments } from "./useComposerAttachments.ts"
import { useComposerPalette } from "./useComposerPalette.ts"
import { useComposerPreferences } from "./useComposerPreferences.ts"
import { useModelCatalog } from "./useModelCatalog.ts"
import { useVoiceComposerInput } from "./useVoiceComposerInput.ts"
import { getVoiceErrorNotice } from "./voice-error-display.ts"
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input"
import { useSkillInventoryResource } from "@/components/AppDataHooks"
import { ErrorNotice } from "@/components/ErrorNotice"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { authTypeLabel } from "@/routes/Connections/shared"

interface ChatComposerProps {
  error: string | null
  focusRequest: number
  generatedArtifacts?: ArtifactSelection | null
  hasMessages: boolean
  historyScope: string
  initialComposerState?: ComposerState
  messages: ChatMessage[]
  knowledgeBaseIds: string[]
  knowledgeEnabled: boolean
  knowledgeError: string | null
  knowledgeItems: KnowledgeBaseSummary[]
  knowledgeLoading: boolean
  permissionMode: AgentPermissionMode
  pendingQuestions: ChatQuestionRequest[]
  placeholder: string
  teamSkills?: ChatTeamSkillContext[]
  providers: ConnectionProvider[]
  queueHeld: boolean
  queuedMessages: QueuedChatMessage[]
  contextBar?: React.ReactNode
  turnState: ChatTurnState
  submitDisabled: boolean
  willQueueMessage: boolean
  onQueuedMessageMove: (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => void
  onQueuedMessageRemove: (id: string) => void
  onQueuedMessageResume: () => void
  onComposerStateChange?: (state: ComposerState) => void
  onSend: (request: ChatSendRequest) => Promise<ChatSendResult>
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>
  onPermissionModeDefault: () => void
  onPermissionModeFullAccess: () => void
  onOpenConnectionProvider?: (service: string, displayName: string) => void
  onOpenKnowledgeLibrary?: () => void
  onSelectKnowledgeBase: (id: string) => void
  onStop: () => Promise<void> | void
  onViewBilling?: () => void
}

interface VisibleComposerError {
  error: UserFacingError
  showDiagnosticsCopy: boolean
  onDismiss?: () => void
}

function trustedComposerInputError(message: string): UserFacingError {
  return {
    area: "chat",
    kind: "validation_error",
    severity: "warning",
    titleKey: "error.validation.title",
    descriptionKey: "error.validation.description",
    descriptionText: message,
  }
}

function paletteLabels({
  accountHeaderLabel,
  isSkillInventoryLoading,
  isContextTrigger,
  mode,
  t,
}: {
  accountHeaderLabel?: string
  isSkillInventoryLoading: boolean
  isContextTrigger: boolean
  mode: "connection-accounts" | "connections" | "root" | "skills"
  t: ReturnType<typeof useT>
}): { emptyLabel: string; headerLabel?: string } {
  if (mode === "connection-accounts") {
    return {
      emptyLabel: t("chat.connectionPaletteEmpty"),
      headerLabel: accountHeaderLabel
        ? t("chat.connectionAccountsHeader", { name: accountHeaderLabel })
        : t("chat.paletteConnectionsHeader"),
    }
  }
  if (isContextTrigger) {
    return {
      emptyLabel: t("chat.contextPaletteEmpty"),
      headerLabel: t("chat.paletteContextHeader"),
    }
  }
  if (mode === "connections") {
    return {
      emptyLabel: t("chat.connectionPaletteEmpty"),
      headerLabel: t("chat.paletteConnectionsHeader"),
    }
  }
  if (mode === "skills") {
    return {
      emptyLabel: isSkillInventoryLoading ? t("chat.skillPaletteLoading") : t("chat.skillPaletteEmpty"),
      headerLabel: t("chat.paletteSkillsHeader"),
    }
  }
  return { emptyLabel: t("chat.commandPaletteEmpty") }
}

export function ChatComposer({
  error,
  focusRequest,
  generatedArtifacts = null,
  hasMessages,
  historyScope,
  initialComposerState: initialComposerStateProp,
  messages,
  knowledgeBaseIds,
  knowledgeEnabled,
  knowledgeError,
  knowledgeItems,
  knowledgeLoading,
  permissionMode,
  pendingQuestions = [],
  placeholder,
  teamSkills = [],
  providers,
  queueHeld,
  queuedMessages,
  contextBar,
  turnState,
  submitDisabled,
  willQueueMessage,
  onQueuedMessageMove,
  onQueuedMessageRemove,
  onQueuedMessageResume,
  onComposerStateChange,
  onSend,
  onAnswerQuestion,
  onPermissionModeDefault,
  onPermissionModeFullAccess,
  onOpenConnectionProvider,
  onOpenKnowledgeLibrary,
  onSelectKnowledgeBase,
  onStop,
  onViewBilling,
}: ChatComposerProps) {
  const t = useT()
  const skillInventory = useSkillInventoryResource()
  const modelCatalogState = useModelCatalog()
  const [composer, dispatchComposer] = React.useReducer(
    composerReducer,
    initialComposerStateProp ?? initialComposerState(),
  )
  const [inputError, setInputError] = React.useState<UserFacingError | null>(null)
  const clearInputError = React.useCallback(() => setInputError(null), [])
  const showTrustedInputError = React.useCallback(
    (message: string) => setInputError(trustedComposerInputError(message)),
    [],
  )
  const showUnexpectedInputError = React.useCallback(
    (cause: unknown) => setInputError(resolveUserFacingError(cause, { area: "chat" })),
    [],
  )
  const [answeringQuestion, setAnsweringQuestion] = React.useState(false)
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null)
  const [storedComposerHistory, setStoredComposerHistory] = React.useState(() =>
    readStoredComposerHistory(historyScope),
  )
  const { agentMode, reasoningLevel, setAgentMode, setReasoningLevel } = useComposerPreferences()
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const appendVoiceTranscription = React.useCallback((text: string) => {
    dispatchComposer({ type: "insert-transcription", text })
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])
  const voiceInput = useVoiceComposerInput(appendVoiceTranscription)
  const paletteId = React.useId()
  const { attachments, command, contextMentions, dismissedTriggerKey, draft, draftSelection } = composer
  React.useEffect(() => {
    setStoredComposerHistory(readStoredComposerHistory(historyScope))
    setHistoryIndex(null)
  }, [historyScope])
  const composerHistory = React.useMemo(() => {
    const currentChatHistory = buildComposerHistory(messages, queuedMessages)
    return mergeComposerHistories(currentChatHistory, storedComposerHistory)
  }, [messages, queuedMessages, storedComposerHistory])
  React.useEffect(() => {
    if (historyIndex !== null && draft !== composerHistory[historyIndex]) {
      setHistoryIndex(null)
    }
  }, [composerHistory, draft, historyIndex])
  const activePendingQuestion = pendingQuestions[0]
  const activePendingQuestionId = activePendingQuestion?.id
  const composerQuestionBlocked = Boolean(activePendingQuestion && !isSingleTextQuestion(activePendingQuestion))
  const composerAttachmentsDisabled = Boolean(activePendingQuestion)
  const composerTurnState: ChatTurnState = activePendingQuestion ? { chatStatus: "ready", status: "idle" } : turnState
  const composerWillQueueMessage = activePendingQuestion ? false : willQueueMessage
  const initialSendPending = turnState.status === "submitting" && turnState.initialSendPending
  const submitBlocked = submitDisabled || initialSendPending
  const composerDisabled =
    submitDisabled || voiceInput.busy || initialSendPending || answeringQuestion || composerQuestionBlocked
  const modelCatalog = modelCatalogState.catalog
  const modelError = modelCatalogState.selectionError ?? modelCatalogState.catalogError
  const composerAttachments = useComposerAttachments({
    attachments,
    clearInputError,
    disabled: composerDisabled || composerAttachmentsDisabled,
    dispatch: dispatchComposer,
    showTrustedInputError,
    showUnexpectedInputError,
  })
  React.useEffect(() => {
    setAnsweringQuestion(false)
  }, [activePendingQuestionId])
  const platform = globalThis.wanta?.platform
  const slashItems = React.useMemo(
    () =>
      slashCommandItems({
        canViewBilling: Boolean(onViewBilling),
        platform,
        t,
      }),
    [onViewBilling, platform, t],
  )
  const skillItems = React.useMemo(
    () =>
      buildSkillPaletteItems(
        skillInventory.data?.groups ?? [],
        t("chat.skillFallbackDescription"),
        {
          description: t("chat.commandCreatorSkillDescription"),
          title: t("chat.commandCreatorSkill"),
        },
        teamSkills,
      ),
    [teamSkills, skillInventory.data?.groups, t],
  )
  const connectionItems = React.useMemo(
    () =>
      buildConnectionPaletteItems(providers, (service) => t("chat.connectionFallbackDescription", { service }), {
        accountActiveHint: t("chat.connectionAccountActiveHint"),
        accountCount: (count) => t("chat.connectionAccountCount", { count }),
        accountFallbackLabel: (auth, index) => t("connections.generatedConnectionLabel", { auth, index }),
        authLabel: (authType) => (authType ? authTypeLabel(t, authType) : t("connections.authUnknown")),
        connectProvider: t("chat.connectionConnectDescription"),
        defaultAccountDescription: (account) => t("chat.connectionDefaultAccountDescription", { account }),
        defaultLabel: t("connections.defaultConnection"),
        needsAttention: t("connections.needsAttention"),
        unsupportedProvider: t("chat.connectionUnsupportedDescription"),
      }),
    [providers, t],
  )
  const artifactItems = React.useMemo(() => buildArtifactPaletteItems(generatedArtifacts, t), [generatedArtifacts, t])
  const knowledgePaletteItems = React.useMemo(
    () =>
      knowledgeEnabled
        ? buildKnowledgePaletteItems(
            knowledgeItems,
            knowledgeBaseIds,
            {
              emptyDescription: t("chat.knowledgePaletteEmptyDescription"),
              emptyTitle: t("chat.knowledgePaletteEmptyTitle"),
              failedDescription: t("chat.knowledgePaletteFailedDescription"),
              failedTitle: t("chat.knowledgePaletteFailedTitle"),
              loadingDescription: t("chat.knowledgePaletteLoadingDescription"),
              loadingTitle: t("chat.knowledgePaletteLoadingTitle"),
              selected: t("chat.knowledgePaletteSelected"),
            },
            { error: Boolean(knowledgeError), loading: knowledgeLoading },
          )
        : [],
    [knowledgeBaseIds, knowledgeEnabled, knowledgeError, knowledgeItems, knowledgeLoading, t],
  )
  const contextItems = React.useMemo(
    () =>
      buildContextPaletteItems({ artifactItems, connectionItems, knowledgeItems: knowledgePaletteItems, platform, t }),
    [artifactItems, connectionItems, knowledgePaletteItems, platform, t],
  )
  const providerByService = React.useMemo(
    () => new Map(providers.map((provider) => [normalizeServiceSlug(provider.service), provider])),
    [providers],
  )
  React.useLayoutEffect(() => {
    if (focusRequest <= 0) {
      return
    }
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest])

  React.useEffect(() => {
    onComposerStateChange?.(composer)
  }, [composer, onComposerStateChange])

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || textarea.value !== draft) {
      return
    }
    textarea.setSelectionRange(draftSelection.start, draftSelection.end)
  }, [draft, draftSelection])

  const updateDraftSelection = React.useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    dispatchComposer({
      type: "set-draft-selection",
      selection: {
        end: textarea.selectionEnd,
        start: textarea.selectionStart,
      },
    })
  }, [])

  const focusDraftAt = React.useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) {
        return
      }
      textarea.focus()
      textarea.setSelectionRange(index, index)
      dispatchComposer({ type: "set-draft-selection", selection: { end: index, start: index } })
    })
  }, [])

  const addContextMention = React.useCallback((mention: ChatContextMention) => {
    dispatchComposer({ type: "add-context-mention", mention })
  }, [])

  const removeContextMention = React.useCallback((mention: ChatContextMention) => {
    dispatchComposer({ type: "remove-context-mention", mention })
  }, [])
  const composerPalette = useComposerPalette({
    connectionItems,
    contextItems,
    disabled: composerDisabled,
    dismissedTriggerKey,
    dispatch: dispatchComposer,
    draft,
    draftSelection,
    focusDraftAt,
    onAddArtifactAttachment: (item) => {
      composerAttachments.addAttachments([
        {
          kind: item.artifact.kind,
          mime: item.artifact.mime,
          name: item.artifact.name,
          path: item.artifact.path,
          size: item.artifact.size ?? 0,
        },
      ])
    },
    onAddContextMention: addContextMention,
    onOpenConnectionProvider,
    onOpenKnowledgeLibrary,
    onSelectAttachments: (kind) => {
      if (composerDisabled || composerAttachmentsDisabled) {
        return
      }
      void composerAttachments.selectAttachments(kind)
    },
    onSelectKnowledgeBase,
    onViewBilling,
    skillItems,
    slashItems,
  })
  const resetHistoryNavigation = React.useCallback(() => setHistoryIndex(null), [])
  const appendComposerHistory = React.useCallback(
    (text: string): void => {
      setStoredComposerHistory(appendStoredComposerHistory(historyScope, text))
    },
    [historyScope],
  )
  const handleComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      composerPalette.handleKeyDown(event)
      if (
        event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown")
      ) {
        return
      }

      if (
        historyIndex === null &&
        (event.key !== "ArrowUp" || Boolean(activePendingQuestion) || hasComposerDraftContent(composer))
      ) {
        return
      }

      const navigation = navigateComposerHistory(
        composerHistory,
        historyIndex,
        event.key === "ArrowUp" ? "older" : "newer",
      )
      if (!navigation) {
        return
      }
      event.preventDefault()
      setHistoryIndex(navigation.index)
      dispatchComposer({ draft: navigation.text, type: "recall-history" })
    },
    [activePendingQuestion, composer, composerHistory, composerPalette, historyIndex],
  )

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过 ComposerTrailingControls
  // 的按钮点击触发，避免生成中按回车误中止流。
  const handleSubmit = async (message: PromptInputMessage): Promise<void> => {
    const text = message.text
    if (activePendingQuestion) {
      if (!isSingleTextQuestion(activePendingQuestion)) {
        return
      }
      if (submitBlocked || composerDisabled || answeringQuestion) {
        return
      }
      if (attachments.length > 0) {
        showTrustedInputError(t("chat.questionAttachmentUnsupported"))
        return
      }
      if (text.trim().length === 0) {
        return
      }
      setAnsweringQuestion(true)
      try {
        await onAnswerQuestion(activePendingQuestion.id, answerSingleTextQuestion(activePendingQuestion, text))
        appendComposerHistory(text)
        composerAttachments.revokeCurrentPreviews()
        resetHistoryNavigation()
        dispatchComposer({ type: "reset-after-submit" })
        clearInputError()
      } catch (err) {
        setAnsweringQuestion(false)
        showUnexpectedInputError(err)
      }
      return
    }
    if (
      (text.trim().length === 0 && attachments.length === 0 && command === null) ||
      submitBlocked ||
      composerDisabled
    ) {
      return
    }
    let clearedAfterSubmit = false
    const clearAfterOptimisticSubmit = (): void => {
      if (clearedAfterSubmit) {
        return
      }
      clearedAfterSubmit = true
      composerAttachments.revokeCurrentPreviews()
      resetHistoryNavigation()
      dispatchComposer({ type: "reset-after-submit" })
      clearInputError()
    }
    let result: ChatSendResult
    try {
      result = await onSend({
        afterOptimisticSubmit: clearAfterOptimisticSubmit,
        attachments: attachments.map(stripDraftAttachment),
        contextMentions,
        mode: agentMode,
        model: modelCatalog?.selected,
        permissionMode,
        reasoningLevel,
        text: composerSubmissionText({ command, draft: text }),
      })
    } catch (err) {
      showUnexpectedInputError(err)
      return
    }
    if (result.status === "failed") {
      showUnexpectedInputError(result.error)
      return
    }
    if (result.status !== "accepted") {
      showTrustedInputError(t("chat.sendNotAccepted"))
      return
    }
    // 文本历史无法恢复命令 chip；排除命令，避免召回后把命令备注误发成普通消息。
    if (command === null) {
      appendComposerHistory(text)
    }
    clearAfterOptimisticSubmit()
  }

  const visibleError = React.useMemo<VisibleComposerError | null>(() => {
    if (error) {
      return { error: resolveUserFacingError(error, { area: "chat" }), showDiagnosticsCopy: true }
    }
    if (inputError) {
      return {
        error: inputError,
        showDiagnosticsCopy: false,
      }
    }
    if (modelError) {
      return { error: modelError, showDiagnosticsCopy: true }
    }
    const voiceNotice = getVoiceErrorNotice({
      recorderError: voiceInput.recorderError,
      transcriptionError: voiceInput.error,
      transcriptionErrorKind: voiceInput.errorKind,
    })
    if (voiceNotice) {
      return { ...voiceNotice, onDismiss: voiceInput.dismissError }
    }
    return null
  }, [
    error,
    inputError,
    modelError,
    voiceInput.dismissError,
    voiceInput.error,
    voiceInput.errorKind,
    voiceInput.recorderError,
  ])
  const errorBanner = visibleError ? (
    <ErrorNotice
      error={visibleError.error}
      compact
      showDiagnosticsCopy={visibleError.showDiagnosticsCopy}
      onDismiss={visibleError.onDismiss}
    />
  ) : null
  const submitText = draft
  const canSubmit = activePendingQuestion
    ? !submitBlocked && !composerDisabled && attachments.length === 0 && submitText.trim().length > 0
    : !submitBlocked &&
      !composerDisabled &&
      (command !== null || submitText.trim().length > 0 || attachments.length > 0)
  const composerPlaceholder = activePendingQuestion
    ? composerQuestionBlocked
      ? t("chat.questionComposerBlockedPlaceholder")
      : t("chat.questionComposerPlaceholder")
    : placeholder
  const hasInputAddons = command !== null || attachments.length > 0 || contextMentions.length > 0
  const contextUsage = React.useMemo(() => buildContextUsageInfo(messages, modelCatalog), [messages, modelCatalog])

  const promptInput = (
    <PromptInput
      onSubmit={handleSubmit}
      className={cn("oo-composer", hasMessages && "shrink-0")}
      onDragOver={composerAttachments.handleDragOver}
      onDrop={composerAttachments.handleDrop}
    >
      {hasInputAddons ? (
        <PromptInputAttachments>
          <div className="flex max-h-[min(42vh,20rem)] w-full flex-col gap-2 overflow-y-auto pr-1">
            {command === "bug-report" ? (
              <div className="flex w-full flex-wrap gap-2">
                <span
                  className="oo-border-divider oo-text-body flex h-8 max-w-full min-w-0 items-center gap-2 rounded-lg border bg-background/70 px-2 shadow-xs"
                  title={t("chat.commandBugReportDescription")}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Bug className="size-3.5" />
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground">{t("chat.commandBugReport")}</span>
                  {!composerDisabled ? (
                    <button
                      type="button"
                      aria-label={t("chat.contextRemove", { name: t("chat.commandBugReport") })}
                      className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => dispatchComposer({ type: "remove-command" })}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}
            <ContextMentionChips
              mentions={contextMentions}
              providerByService={providerByService}
              onRemove={composerDisabled ? undefined : removeContextMention}
            />
            {attachments.length > 0 ? (
              <AttachmentList
                attachments={attachments}
                onRemove={composerDisabled ? undefined : composerAttachments.removeAttachment}
              />
            ) : null}
          </div>
        </PromptInputAttachments>
      ) : null}
      <PromptInputBody>
        <PromptInputTextarea
          ref={textareaRef}
          className={cn(hasInputAddons && "pt-2")}
          value={draft}
          disabled={composerDisabled}
          placeholder={composerPlaceholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={composerPalette.open}
          aria-controls={composerPalette.open ? paletteId : undefined}
          aria-activedescendant={
            composerPalette.open && composerPalette.activeItem
              ? composerPaletteItemElementId(paletteId, composerPalette.activeItem.id)
              : undefined
          }
          onChange={(e) => {
            resetHistoryNavigation()
            dispatchComposer({
              type: "set-draft",
              draft: e.target.value,
              selection: {
                end: e.target.selectionEnd,
                start: e.target.selectionStart,
              },
            })
          }}
          onClick={() => {
            resetHistoryNavigation()
            updateDraftSelection()
          }}
          onKeyDown={handleComposerKeyDown}
          onKeyUp={updateDraftSelection}
          onSelect={updateDraftSelection}
          onPaste={composerAttachments.handlePaste}
        />
      </PromptInputBody>
      <PromptInputToolbar className="oo-composer-toolbar min-w-0 flex-nowrap overflow-hidden">
        <ComposerAttachmentMenu
          disabled={composerDisabled || composerAttachmentsDisabled}
          fileInputRef={composerAttachments.fileInputRef}
          onFileInputChange={composerAttachments.handleFileInputChange}
          onSelectDirectory={() => composerAttachments.selectAttachments("directory")}
          onSelectFile={() => composerAttachments.selectAttachments("file")}
        />
        <ComposerTrailingControls
          canSubmit={canSubmit}
          composerDisabled={composerDisabled}
          contextUsage={contextUsage}
          turnState={composerTurnState}
          modelCatalog={modelCatalog}
          agentMode={agentMode}
          permissionMode={permissionMode}
          reasoningLevel={reasoningLevel}
          voiceActive={voiceInput.active}
          voiceBars={voiceInput.bars}
          voiceDurationMs={voiceInput.durationMs}
          voiceError={voiceInput.error}
          voiceRecorderError={voiceInput.recorderError}
          voiceRetryBlob={voiceInput.retryBlob}
          voiceStarting={voiceInput.starting}
          voiceTranscribing={voiceInput.transcribing}
          willQueueMessage={composerWillQueueMessage}
          onAddModel={modelCatalogState.openDialog}
          onCancelVoice={voiceInput.cancel}
          onDeleteModel={modelCatalogState.deleteModel}
          onRetryVoice={voiceInput.retry}
          onSelectAgentMode={setAgentMode}
          onSelectDefaultPermissionMode={onPermissionModeDefault}
          onRequestFullAccessPermissionMode={onPermissionModeFullAccess}
          onSelectReasoningLevel={setReasoningLevel}
          onSelectModel={modelCatalogState.selectModel}
          onStartVoice={voiceInput.start}
          onStop={onStop}
          onStopVoice={() => void voiceInput.stop()}
        />
      </PromptInputToolbar>
    </PromptInput>
  )

  const modelDialog = (
    <AddCustomModelDialog
      open={modelCatalogState.dialogOpen}
      providers={modelCatalog?.providers ?? []}
      error={modelCatalogState.dialogError}
      onClose={modelCatalogState.closeDialog}
      onSave={modelCatalogState.saveModel}
    />
  )
  const queuePanel = (
    <QueuedMessagePanel
      messages={queuedMessages}
      queueHeld={queueHeld}
      onMove={onQueuedMessageMove}
      onRemove={onQueuedMessageRemove}
      onResume={onQueuedMessageResume}
    />
  )
  const accountHeaderLabel =
    composerPalette.mode === "connection-accounts" &&
    (composerPalette.activeItem?.kind === "connection-account" ||
      composerPalette.activeItem?.kind === "connection-provider")
      ? composerPalette.activeItem.displayName
      : undefined
  const { emptyLabel, headerLabel } = paletteLabels({
    accountHeaderLabel,
    isSkillInventoryLoading: skillInventory.isInitialLoading,
    isContextTrigger: composerPalette.activeTrigger?.kind === "context",
    mode: composerPalette.mode,
    t,
  })
  const palette =
    composerPalette.open && composerPalette.activeTrigger ? (
      <ComposerPalette
        activeId={composerPalette.activeItem?.id}
        backLabel={t("chat.questionPrevious")}
        emptyLabel={emptyLabel}
        headerLabel={headerLabel}
        id={paletteId}
        items={composerPalette.items}
        label={headerLabel ?? t("chat.paletteLabel")}
        onBack={composerPalette.handleBack}
        onSelect={composerPalette.onSelect}
        onSecondarySelect={composerPalette.onSecondarySelect}
      />
    ) : null

  return (
    <>
      {errorBanner}
      <div className="flex flex-col gap-2">
        <div className="relative">
          {palette}
          <div className="relative z-10">{queuePanel}</div>
          <div className="relative z-20">{promptInput}</div>
          {contextBar ? (
            <div className="oo-composer-context-tray relative z-0 -mt-4 flex h-12 min-w-0 items-center overflow-hidden rounded-b-[1.375rem] px-4 pt-4 text-[0.8125rem] leading-[1.125rem] text-muted-foreground">
              {contextBar}
            </div>
          ) : null}
        </div>
      </div>
      {modelDialog}
    </>
  )
}
