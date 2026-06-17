import type { ChatAttachment, ChatContextMention } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { QueuedChatMessage } from "@/components/app-shell/chat-queue"
import type { ChatStatus } from "ai"

import { AlertTriangle, ChevronRight, File as FileIcon, Folder, ListChecks, Package, Plug, Plus, X } from "lucide-react"
import * as React from "react"
import { AttachmentList } from "./ChatAttachments.tsx"
import { buildConnectionPaletteItems, buildSkillPaletteItems, slashCommandItems } from "./composer-palette-items.ts"
import { composerReducer, contextMentionKey, initialComposerState } from "./composer-state.ts"
import { ComposerPalette } from "./ComposerPalette.tsx"
import { ComposerTrailingControls } from "./ComposerTrailingControls.tsx"
import { AddCustomModelDialog } from "./ModelControls.tsx"
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
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ChatComposerProps {
  disabled: boolean
  error: string | null
  hasMessages: boolean
  initialSendPending: boolean
  placeholder: string
  providers: ConnectionProvider[]
  queuedMessages: QueuedChatMessage[]
  status: ChatStatus
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

function contextMentionLabel(mention: ChatContextMention): string {
  return mention.kind === "skill" ? mention.name : mention.displayName
}

function ContextMentionChips({
  mentions,
  onRemove,
}: {
  mentions: ChatContextMention[]
  onRemove?: (mention: ChatContextMention) => void
}) {
  const t = useT()
  if (mentions.length === 0) {
    return null
  }
  return (
    <div className="flex w-full flex-wrap gap-2">
      {mentions.map((mention) => (
        <span
          key={contextMentionKey(mention)}
          className="oo-border-divider flex h-8 max-w-full items-center gap-2 rounded-lg border bg-background/70 px-2 text-sm shadow-xs"
          title={mention.kind === "skill" ? mention.description : mention.accountLabel}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {mention.kind === "skill" ? <Package className="size-3.5" /> : <Plug className="size-3.5" />}
          </span>
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">
              {mention.kind === "skill" ? t("chat.contextSkillPrefix") : t("chat.contextConnectionPrefix")}
            </span>
            <span className="ml-1 font-medium text-foreground">{contextMentionLabel(mention)}</span>
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={t("chat.contextRemove", { name: contextMentionLabel(mention) })}
              className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onRemove(mention)}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function queuedMessagePreview(message: QueuedChatMessage): string {
  const text = message.text.trim()
  if (text) {
    return text
  }
  return message.attachments.map((attachment) => attachment.name).join(", ")
}

function QueuedMessagePanel({ messages, onRemove }: { messages: QueuedChatMessage[]; onRemove: (id: string) => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(true)
  if (messages.length === 0) {
    return null
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="oo-border-divider overflow-hidden rounded-xl border bg-background/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className={cn("flex h-9 items-center px-2", open && "border-b border-border/50")}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={open ? t("chat.queueCollapse") : t("chat.queueExpand")}
          >
            <ListChecks className="size-4 shrink-0 text-muted-foreground" />
            <span className="oo-text-control min-w-0 flex-1 truncate text-muted-foreground">
              {t("chat.queueTitle", { count: messages.length })}
            </span>
            <ChevronRight
              className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="max-h-40 overflow-auto">
          {messages.map((message) => {
            const preview = queuedMessagePreview(message)
            return (
              <div key={message.id} className="flex h-10 items-center gap-2 px-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="oo-text-control min-w-0 truncate text-foreground/90">
                      {preview || t("chat.queueAttachmentOnly")}
                    </span>
                  </div>
                  {message.attachments.length > 0 ? (
                    <div className="oo-text-caption mt-0.5 truncate text-muted-foreground">
                      {t("chat.queueAttachments", { count: message.attachments.length })}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  title={t("chat.queueRemove")}
                  aria-label={t("chat.queueRemove")}
                  onClick={() => onRemove(message.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
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
  disabled,
  error,
  hasMessages,
  initialSendPending,
  placeholder,
  providers,
  queuedMessages,
  status,
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
  const { activePaletteIndex, attachments, contextMentions, dismissedTriggerKey, draft, draftSelection, paletteMode } =
    composer
  const isSubmitted = status === "submitted"
  const isGenerating = status === "submitted" || status === "streaming"
  const composerDisabled = disabled || voiceInput.busy || initialSendPending
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
    activePaletteIndex,
    connectionItems,
    disabled: composerDisabled,
    dismissedTriggerKey,
    dispatch: dispatchComposer,
    draft,
    draftSelection,
    focusDraftAt,
    onAddContextMention: addContextMention,
    onViewBilling,
    paletteMode,
    skillItems,
    slashItems,
  })

  // 表单提交（含回车）始终走"发送"路径；"停止"只通过 ComposerTrailingControls
  // 的按钮点击触发，避免生成中按回车误中止流。
  const handleSubmit = async (message: PromptInputMessage): Promise<void> => {
    const text = message.text
    if ((!text && attachments.length === 0) || disabled || initialSendPending || voiceInput.busy) {
      return
    }
    const accepted = await onSend(text, attachments.map(stripDraftAttachment), contextMentions, modelCatalog?.selected)
    if (!accepted) {
      setInputError(t("chat.sendNotAccepted"))
      return
    }
    composerAttachments.revokeCurrentPreviews()
    dispatchComposer({ type: "reset-after-submit" })
    setInputError(null)
  }

  const visibleError = error ?? inputError ?? modelError ?? voiceInput.error ?? voiceInput.recorderError
  const errorBanner = visibleError ? (
    <div className="oo-error flex items-center gap-2">
      <AlertTriangle className="size-4" />
      {visibleError}
    </div>
  ) : null
  const canSubmit = !composerDisabled && (draft.trim().length > 0 || attachments.length > 0)

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
          isSubmitted={isSubmitted}
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
    mode: paletteMode,
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
