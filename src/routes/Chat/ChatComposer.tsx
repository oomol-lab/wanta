import type {
  AgentMode,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatOrganizationSkillContext,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { ComposerState } from "./composer-state.ts"
import type { ArtifactSelection } from "./GeneratedArtifacts.tsx"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { QueuedChatMessage, QueuedMessageMovePlacement } from "@/components/app-shell/chat-queue"
import type { ChatStatus } from "ai"

import { File as FileIcon, Folder, Plus } from "lucide-react"
import * as React from "react"
import { WANTA_AGENT_MODES, WANTA_DEFAULT_AGENT_MODE } from "../../../electron/agent/mode.ts"
import { WANTA_DEFAULT_REASONING_LEVEL, WANTA_REASONING_LEVELS } from "../../../electron/agent/reasoning.ts"
import { AttachmentList } from "./ChatAttachments.tsx"
import {
  buildArtifactPaletteItems,
  buildConnectionPaletteItems,
  buildContextPaletteItems,
  buildSkillPaletteItems,
  slashCommandItems,
} from "./composer-palette-items.ts"
import { composerReducer, initialComposerState } from "./composer-state.ts"
import { ComposerPalette } from "./ComposerPalette.tsx"
import { ComposerTrailingControls } from "./ComposerTrailingControls.tsx"
import { buildContextUsageInfo } from "./context-usage.ts"
import { ContextMentionChips } from "./ContextMentionChips.tsx"
import { AddCustomModelDialog } from "./ModelControls.tsx"
import { QueuedMessagePanel } from "./QueuedMessagePanel.tsx"
import { stripDraftAttachment, useComposerAttachments } from "./useComposerAttachments.ts"
import { useComposerPalette } from "./useComposerPalette.ts"
import { useModelCatalog } from "./useModelCatalog.ts"
import { useVoiceComposerInput } from "./useVoiceComposerInput.ts"
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import { useSkillInventoryResource } from "@/components/AppDataHooks"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

interface ChatComposerProps {
  error: string | null
  focusRequest: number
  generatedArtifacts?: ArtifactSelection | null
  hasMessages: boolean
  initialComposerState?: ComposerState
  initialSendPending: boolean
  messages: ChatMessage[]
  placeholder: string
  organizationSkills?: ChatOrganizationSkillContext[]
  providers: ConnectionProvider[]
  queueHeld: boolean
  queuedMessages: QueuedChatMessage[]
  contextBar?: React.ReactNode
  status: ChatStatus
  submitDisabled: boolean
  onQueuedMessageMove: (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => void
  onQueuedMessageRemove: (id: string) => void
  onQueuedMessageResume: () => void
  onComposerStateChange?: (state: ComposerState) => void
  onSend: (
    text: string,
    attachments: ChatAttachment[],
    contextMentions: ChatContextMention[],
    model?: ModelChoice,
    reasoningLevel?: ReasoningLevel,
    mode?: AgentMode,
  ) => Promise<boolean>
  onStop: () => void
  onViewBilling?: () => void
}

const reasoningLevelStorageKey = "wanta:chat:reasoning-level"
const reasoningLevels = new Set<ReasoningLevel>(WANTA_REASONING_LEVELS)
const agentModeStorageKey = "wanta:chat:agent-mode"
const agentModes = new Set<AgentMode>(WANTA_AGENT_MODES)

function readStoredReasoningLevel(): ReasoningLevel {
  try {
    const stored = globalThis.localStorage?.getItem(reasoningLevelStorageKey)
    return reasoningLevels.has(stored as ReasoningLevel) ? (stored as ReasoningLevel) : WANTA_DEFAULT_REASONING_LEVEL
  } catch {
    return WANTA_DEFAULT_REASONING_LEVEL
  }
}

function writeStoredReasoningLevel(level: ReasoningLevel): void {
  try {
    globalThis.localStorage?.setItem(reasoningLevelStorageKey, level)
  } catch {
    // localStorage 不可用时保持本次会话内状态即可。
  }
}

function readStoredAgentMode(): AgentMode {
  try {
    const stored = globalThis.localStorage?.getItem(agentModeStorageKey)
    return agentModes.has(stored as AgentMode) ? (stored as AgentMode) : WANTA_DEFAULT_AGENT_MODE
  } catch {
    return WANTA_DEFAULT_AGENT_MODE
  }
}

function writeStoredAgentMode(mode: AgentMode): void {
  try {
    globalThis.localStorage?.setItem(agentModeStorageKey, mode)
  } catch {
    // localStorage 不可用时保持本次会话内状态即可。
  }
}

function paletteLabels({
  isSkillInventoryLoading,
  isContextTrigger,
  mode,
  t,
}: {
  isSkillInventoryLoading: boolean
  isContextTrigger: boolean
  mode: "connections" | "root" | "skills"
  t: ReturnType<typeof useT>
}): { emptyLabel: string; headerLabel?: string } {
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
  initialComposerState: initialComposerStateProp,
  initialSendPending,
  messages,
  placeholder,
  organizationSkills = [],
  providers,
  queueHeld,
  queuedMessages,
  contextBar,
  status,
  submitDisabled,
  onQueuedMessageMove,
  onQueuedMessageRemove,
  onQueuedMessageResume,
  onComposerStateChange,
  onSend,
  onStop,
  onViewBilling,
}: ChatComposerProps) {
  const t = useT()
  const skillInventory = useSkillInventoryResource()
  const modelCatalogState = useModelCatalog()
  const attachmentMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [composer, dispatchComposer] = React.useReducer(
    composerReducer,
    initialComposerStateProp ?? initialComposerState(),
  )
  const [inputError, setInputError] = React.useState<string | null>(null)
  const [attachmentMenuOpen, setAttachmentMenuOpen] = React.useState(false)
  const [agentMode, setAgentModeState] = React.useState<AgentMode>(readStoredAgentMode)
  const [reasoningLevel, setReasoningLevelState] = React.useState<ReasoningLevel>(readStoredReasoningLevel)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const appendVoiceTranscription = React.useCallback((text: string) => {
    dispatchComposer({ type: "insert-transcription", text })
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])
  const voiceInput = useVoiceComposerInput(appendVoiceTranscription)
  const { attachments, contextMentions, dismissedTriggerKey, draft, draftSelection } = composer
  const isGenerating = status === "submitted" || status === "streaming"
  const submitBlocked = submitDisabled || initialSendPending
  const composerDisabled = voiceInput.busy || initialSendPending
  const modelCatalog = modelCatalogState.catalog
  const modelError = modelCatalogState.selectionError ?? modelCatalogState.catalogError
  const composerAttachments = useComposerAttachments({
    attachments,
    disabled: composerDisabled,
    dispatch: dispatchComposer,
    setInputError,
  })
  const slashItems = React.useMemo(
    () =>
      slashCommandItems({
        canViewBilling: Boolean(onViewBilling),
        t,
      }),
    [onViewBilling, t],
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
        organizationSkills,
      ),
    [organizationSkills, skillInventory.data?.groups, t],
  )
  const connectionItems = React.useMemo(
    () => buildConnectionPaletteItems(providers, (service) => t("chat.connectionFallbackDescription", { service })),
    [providers, t],
  )
  const artifactItems = React.useMemo(() => buildArtifactPaletteItems(generatedArtifacts, t), [generatedArtifacts, t])
  const contextItems = React.useMemo(
    () => buildContextPaletteItems({ artifactItems, connectionItems, t }),
    [artifactItems, connectionItems, t],
  )
  const setReasoningLevel = React.useCallback((level: ReasoningLevel): void => {
    setReasoningLevelState(level)
    writeStoredReasoningLevel(level)
  }, [])
  const setAgentMode = React.useCallback((mode: AgentMode): void => {
    setAgentModeState(mode)
    writeStoredAgentMode(mode)
  }, [])

  React.useEffect(() => {
    if (focusRequest <= 0) {
      return
    }
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest])

  React.useEffect(() => {
    onComposerStateChange?.(composer)
  }, [composer, onComposerStateChange])

  React.useEffect(() => {
    if (!attachmentMenuOpen) {
      return
    }
    if (composerDisabled) {
      setAttachmentMenuOpen(false)
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && attachmentMenuRef.current?.contains(target)) {
        return
      }
      setAttachmentMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setAttachmentMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [attachmentMenuOpen, composerDisabled])

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
    onSelectAttachments: (kind) => {
      if (composerDisabled) {
        return
      }
      void composerAttachments.selectAttachments(kind)
    },
    onViewBilling,
    skillItems,
    slashItems,
  })

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过 ComposerTrailingControls
  // 的按钮点击触发，避免生成中按回车误中止流。
  const handleSubmit = async (message: PromptInputMessage): Promise<void> => {
    const text = message.text
    if ((text.trim().length === 0 && attachments.length === 0) || submitBlocked || composerDisabled) {
      return
    }
    const accepted = await onSend(
      text,
      attachments.map(stripDraftAttachment),
      contextMentions,
      modelCatalog?.selected,
      reasoningLevel,
      agentMode,
    )
    if (!accepted) {
      setInputError(t("chat.sendNotAccepted"))
      return
    }
    composerAttachments.revokeCurrentPreviews()
    dispatchComposer({ type: "reset-after-submit" })
    setInputError(null)
  }

  const visibleError = React.useMemo(() => {
    if (error) {
      return { error: resolveUserFacingError(error, { area: "chat" }), showDiagnosticsCopy: true }
    }
    if (inputError) {
      return {
        error: resolveUserFacingError(inputError, { area: "chat", preserveMessage: true }),
        showDiagnosticsCopy: false,
      }
    }
    if (modelError) {
      return { error: modelError, showDiagnosticsCopy: true }
    }
    const voiceError = voiceInput.error ?? voiceInput.recorderError
    if (voiceError) {
      return { error: resolveUserFacingError(voiceError, { area: "voice" }), showDiagnosticsCopy: true }
    }
    return null
  }, [error, inputError, modelError, voiceInput.error, voiceInput.recorderError])
  const errorBanner = visibleError ? (
    <ErrorNotice error={visibleError.error} compact showDiagnosticsCopy={visibleError.showDiagnosticsCopy} />
  ) : null
  const submitText = draft
  const canSubmit = !submitBlocked && !composerDisabled && (submitText.trim().length > 0 || attachments.length > 0)
  const hasInputAddons = attachments.length > 0 || contextMentions.length > 0
  const contextUsage = React.useMemo(() => buildContextUsageInfo(messages, modelCatalog), [messages, modelCatalog])

  const promptInput = (
    <PromptInput
      onSubmit={handleSubmit}
      className={cn(hasMessages && "shrink-0")}
      onDragOver={composerAttachments.handleDragOver}
      onDrop={composerAttachments.handleDrop}
    >
      {hasInputAddons ? (
        <PromptInputAttachments>
          <div className="flex max-h-[min(42vh,20rem)] w-full flex-col gap-2 overflow-y-auto pr-1">
            <ContextMentionChips
              mentions={contextMentions}
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
          placeholder={placeholder}
          onChange={(e) => {
            dispatchComposer({
              type: "set-draft",
              draft: e.target.value,
              selection: {
                end: e.target.selectionEnd,
                start: e.target.selectionStart,
              },
            })
          }}
          onClick={updateDraftSelection}
          onKeyDown={composerPalette.handleKeyDown}
          onKeyUp={updateDraftSelection}
          onSelect={updateDraftSelection}
          onPaste={composerAttachments.handlePaste}
        />
      </PromptInputBody>
      <PromptInputToolbar>
        <PromptInputTools className="shrink-0 justify-start">
          <input
            ref={composerAttachments.fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={composerAttachments.handleFileInputChange}
          />
          <div ref={attachmentMenuRef} className="relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("chat.attachFile")}
              aria-label={t("chat.attachFile")}
              aria-expanded={attachmentMenuOpen}
              disabled={composerDisabled}
              className="size-8 rounded-full"
              onClick={() => setAttachmentMenuOpen((open) => !open)}
            >
              <Plus className="size-4" />
            </Button>
            {attachmentMenuOpen ? (
              <div className="absolute bottom-full left-0 z-50 mb-2 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                <AttachmentMenuButton
                  disabled={composerDisabled}
                  onClick={() => {
                    if (composerDisabled) {
                      return
                    }
                    setAttachmentMenuOpen(false)
                    void composerAttachments.selectAttachments("file")
                  }}
                >
                  <FileIcon className="size-4" />
                  {t("chat.attachFileAction")}
                </AttachmentMenuButton>
                <AttachmentMenuButton
                  disabled={composerDisabled}
                  onClick={() => {
                    if (composerDisabled) {
                      return
                    }
                    setAttachmentMenuOpen(false)
                    void composerAttachments.selectAttachments("directory")
                  }}
                >
                  <Folder className="size-4" />
                  {t("chat.attachFolderAction")}
                </AttachmentMenuButton>
              </div>
            ) : null}
          </div>
        </PromptInputTools>
        <ComposerTrailingControls
          canSubmit={canSubmit}
          composerDisabled={composerDisabled}
          contextUsage={contextUsage}
          initialSendPending={initialSendPending}
          isGenerating={isGenerating}
          modelCatalog={modelCatalog}
          agentMode={agentMode}
          reasoningLevel={reasoningLevel}
          status={status}
          voiceActive={voiceInput.active}
          voiceBars={voiceInput.bars}
          voiceDurationMs={voiceInput.durationMs}
          voiceError={voiceInput.error}
          voiceRecorderError={voiceInput.recorderError}
          voiceRetryBlob={voiceInput.retryBlob}
          voiceTranscribing={voiceInput.transcribing}
          onAddModel={modelCatalogState.openDialog}
          onCancelVoice={voiceInput.cancel}
          onDeleteModel={modelCatalogState.deleteModel}
          onRetryVoice={voiceInput.retry}
          onSelectAgentMode={setAgentMode}
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
  const { emptyLabel, headerLabel } = paletteLabels({
    isSkillInventoryLoading: skillInventory.isInitialLoading,
    isContextTrigger: composerPalette.activeTrigger?.kind === "context",
    mode: composerPalette.mode,
    t,
  })
  const palette =
    composerPalette.open && composerPalette.activeTrigger ? (
      <ComposerPalette
        activeId={composerPalette.activeItem?.id}
        emptyLabel={emptyLabel}
        headerLabel={headerLabel}
        items={composerPalette.items}
        onBack={composerPalette.handleBack}
        onSelect={composerPalette.onSelect}
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

function AttachmentMenuButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
