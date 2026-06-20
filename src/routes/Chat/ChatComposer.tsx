import type { ChatAttachment, ChatContextMention } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { QueuedChatMessage } from "@/components/app-shell/chat-queue"
import type { ChatStatus } from "ai"

import { File as FileIcon, Folder, Plus } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { AttachmentList } from "./ChatAttachments.tsx"
import { buildConnectionPaletteItems, buildSkillPaletteItems, slashCommandItems } from "./composer-palette-items.ts"
import { composerReducer, initialComposerState } from "./composer-state.ts"
import { ComposerPalette } from "./ComposerPalette.tsx"
import { ComposerTrailingControls } from "./ComposerTrailingControls.tsx"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

interface ChatComposerProps {
  error: string | null
  hasMessages: boolean
  initialSendPending: boolean
  placeholder: string
  providers: ConnectionProvider[]
  queuedMessages: QueuedChatMessage[]
  status: ChatStatus
  submitDisabled: boolean
  onQueuedMessageRemove: (id: string) => void
  onSend: (
    text: string,
    attachments: ChatAttachment[],
    contextMentions: ChatContextMention[],
    model?: ModelChoice,
  ) => Promise<boolean>
  onStop: () => void
  onViewBilling?: () => void
}

function paletteLabels({
  isSkillInventoryLoading,
  mode,
  t,
}: {
  isSkillInventoryLoading: boolean
  mode: "connections" | "root" | "skills"
  t: ReturnType<typeof useT>
}): { emptyLabel: string; headerLabel?: string } {
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
  hasMessages,
  initialSendPending,
  placeholder,
  providers,
  queuedMessages,
  status,
  submitDisabled,
  onQueuedMessageRemove,
  onSend,
  onStop,
  onViewBilling,
}: ChatComposerProps) {
  const t = useT()
  const skillInventory = useSkillInventoryResource()
  const modelCatalogState = useModelCatalog()
  const [composer, dispatchComposer] = React.useReducer(composerReducer, undefined, initialComposerState)
  const [inputError, setInputError] = React.useState<string | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const appendVoiceTranscription = React.useCallback((text: string) => {
    dispatchComposer({ type: "append-transcription", text })
  }, [])
  const voiceInput = useVoiceComposerInput(appendVoiceTranscription)
  const { attachments, contextMentions, dismissedTriggerKey, draft, draftSelection } = composer
  const isGenerating = status === "submitted" || status === "streaming"
  const submitBlocked = submitDisabled || initialSendPending
  const composerDisabled = voiceInput.busy || initialSendPending
  const modelCatalog = modelCatalogState.catalog
  const modelError = modelCatalogState.error
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
    () => buildSkillPaletteItems(skillInventory.data?.groups ?? [], t("chat.skillFallbackDescription")),
    [skillInventory.data?.groups, t],
  )
  const connectionItems = React.useMemo(
    () => buildConnectionPaletteItems(providers, (service) => t("chat.connectionFallbackDescription", { service })),
    [providers, t],
  )

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
    disabled: composerDisabled,
    dismissedTriggerKey,
    dispatch: dispatchComposer,
    draft,
    draftSelection,
    focusDraftAt,
    onAddContextMention: addContextMention,
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
    const queuedWhileGenerating = isGenerating
    const accepted = await onSend(text, attachments.map(stripDraftAttachment), contextMentions, modelCatalog?.selected)
    if (!accepted) {
      setInputError(t("chat.sendNotAccepted"))
      return
    }
    if (queuedWhileGenerating) {
      toast.success(t("chat.queueAdded"))
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
  const canSubmit = !submitBlocked && !composerDisabled && (draft.trim().length > 0 || attachments.length > 0)

  const promptInput = (
    <PromptInput
      onSubmit={handleSubmit}
      className={cn(hasMessages && "shrink-0")}
      onDragOver={composerAttachments.handleDragOver}
      onDrop={composerAttachments.handleDrop}
    >
      {attachments.length > 0 || contextMentions.length > 0 ? (
        <PromptInputAttachments>
          <div className="flex max-h-44 w-full flex-col gap-2 overflow-y-auto pr-1">
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
          className={cn((attachments.length > 0 || contextMentions.length > 0) && "pt-2")}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("chat.attachFile")}
                aria-label={t("chat.attachFile")}
                disabled={composerDisabled}
                className="size-8 rounded-full"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuItem onSelect={() => void composerAttachments.selectAttachments("file")}>
                <FileIcon className="size-4" />
                {t("chat.attachFileAction")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void composerAttachments.selectAttachments("directory")}>
                <Folder className="size-4" />
                {t("chat.attachFolderAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PromptInputTools>
        <ComposerTrailingControls
          canSubmit={canSubmit}
          composerDisabled={composerDisabled}
          initialSendPending={initialSendPending}
          isGenerating={isGenerating}
          modelCatalog={modelCatalog}
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
      error={modelError}
      onClose={modelCatalogState.closeDialog}
      onSave={modelCatalogState.saveModel}
    />
  )
  const queuePanel = <QueuedMessagePanel messages={queuedMessages} onRemove={onQueuedMessageRemove} />
  const { emptyLabel, headerLabel } = paletteLabels({
    isSkillInventoryLoading: skillInventory.isInitialLoading,
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
        {queuePanel}
        <div className="relative">
          {palette}
          {promptInput}
        </div>
      </div>
      {modelDialog}
    </>
  )
}
