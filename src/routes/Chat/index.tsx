import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatOrganizationSkillContext,
  ChatPermissionReply,
  ChatPermissionRequest,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { ChatTurnRetrySource } from "./chat-turns.ts"
import type { ComposerState } from "./composer-state.ts"
import type { ChatPendingQuestion } from "./question-state.ts"
import type { QueuedChatMessage, QueuedMessageMovePlacement } from "@/components/app-shell/chat-queue"
import type { UserFacingError } from "@/lib/user-facing-error"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"
import type { ChatStatus } from "ai"

import { Building2, ChevronRight, Package, PlugZap } from "lucide-react"
import * as React from "react"
import { ChatComposer } from "./ChatComposer.tsx"
import { ChatTimeline } from "./ChatTimeline.tsx"
import { FullAccessConfirmDialog } from "./FullAccessConfirmDialog.tsx"
import { BrandIcon } from "@/components/BrandIcon"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ChatAreaProps {
  activeSessionId: string | null
  billingCacheScope: string
  composerDraftKey: string
  composerFocusRequest: number
  messages: ChatMessage[]
  permissionMode: AgentPermissionMode
  pendingPermissions: ChatPermissionRequest[]
  pendingQuestions: ChatPendingQuestion[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  showEmptyState: boolean
  bootstrapping: boolean
  startupError?: UserFacingError | null
  error: string | null
  emptyTitle?: string
  generatedArtifacts?: ArtifactSelection | null
  submitDisabled: boolean
  initialComposerState?: ComposerState
  initialSendPending: boolean
  providers: ConnectionProvider[]
  queueHeld: boolean
  queuedMessages: QueuedChatMessage[]
  placeholder: string
  contextBar?: React.ReactNode
  sharedConnectorCount?: number
  organizationSkillEntryVisible?: boolean
  organizationSkillPendingInstallCount?: number
  organizationSkillShowcaseItems?: OrganizationSkillShowcaseItem[]
  organizationSkills?: ChatOrganizationSkillContext[]
  onSend: (
    text: string,
    attachments: ChatAttachment[],
    contextMentions: ChatContextMention[],
    model?: ModelChoice,
    reasoningLevel?: ReasoningLevel,
    mode?: AgentMode,
    permissionMode?: AgentPermissionMode,
  ) => Promise<boolean>
  onPermissionModeChange: (mode: AgentPermissionMode) => void
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>
  onAnswerPermission: (requestId: string, reply: ChatPermissionReply) => Promise<void>
  onContinueQuestion: (request: ChatPendingQuestion["request"], answers: string[][]) => Promise<void>
  onDiscardQuestion: (requestId: string) => void
  onRejectQuestion: (requestId: string) => Promise<void>
  onSetDefaultConnection?: (service: string, appId: string) => Promise<boolean>
  onStop: () => void
  onComposerStateChange?: (state: ComposerState) => void
  onQueuedMessageMove: (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => void
  onQueuedMessageRemove: (id: string) => void
  onQueuedMessageResume: () => void
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onArtifactsReset: () => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onTurnOutputAvailable: (selection: TurnOutputSelection) => void
  onOpenConnections?: () => void
  onOpenConnectionProvider?: (service: string, displayName: string) => void
  onOpenOrganizations?: () => void
  onViewBilling?: () => void
}

const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const EMPTY_COMPOSER_MAX_WIDTH_CLASS = "min-w-0 max-w-[47.5rem]"
interface OrganizationSkillShowcaseItem {
  id: string
  name: string
}

function EmptyStateActions({
  organizationSkillEntryVisible = false,
  organizationSkillPendingInstallCount,
  organizationSkillShowcaseItems = [],
  sharedConnectorCount,
  onOpenConnections,
  onOpenOrganizations,
}: {
  organizationSkillEntryVisible?: boolean
  organizationSkillPendingInstallCount?: number
  organizationSkillShowcaseItems?: OrganizationSkillShowcaseItem[]
  sharedConnectorCount?: number
  onOpenConnections?: () => void
  onOpenOrganizations?: () => void
}) {
  const t = useT()
  const sharedConnectorMeta =
    typeof sharedConnectorCount === "number"
      ? t("chat.emptySharedConnectorsMeta", { count: sharedConnectorCount })
      : t("chat.emptySharedConnectorsMetaFallback")
  const pendingOrganizationSkillCount = organizationSkillPendingInstallCount ?? organizationSkillShowcaseItems.length
  const organizationSkillMeta =
    pendingOrganizationSkillCount > 0
      ? t("chat.emptyOrganizationSkillsMeta", { count: pendingOrganizationSkillCount })
      : t("chat.emptyOrganizationSkillsRecommendedMeta", { count: organizationSkillShowcaseItems.length })
  const organizationSkillAction =
    pendingOrganizationSkillCount > 0
      ? t("chat.emptyOrganizationSkillsAction")
      : t("chat.emptyOrganizationSkillsViewAction")

  return (
    <div className="w-full pl-2 text-muted-foreground">
      <div className="grid min-w-0 justify-start gap-1 overflow-hidden">
        <EmptyCapabilityAction
          icon={<Building2 className="size-4" />}
          title={t("chat.emptySharedConnectorsTitle")}
          meta={sharedConnectorMeta}
          actionLabel={t("chat.emptySharedConnectorsAction")}
          ariaLabel={t("chat.emptyOrganizationsAria")}
          onClick={onOpenOrganizations}
        />
        <EmptyCapabilityAction
          icon={<PlugZap className="size-4" />}
          title={t("chat.emptyConnectorsTitle")}
          meta={t("chat.emptyConnectorsMeta")}
          actionLabel={t("chat.emptyConnectorsAction")}
          ariaLabel={t("chat.emptyConnectorsAria")}
          onClick={onOpenConnections}
        />
        {organizationSkillEntryVisible ? (
          <EmptyCapabilityAction
            icon={<Package className="size-4" />}
            title={t("chat.emptyOrganizationSkillsTitle")}
            meta={organizationSkillMeta}
            actionLabel={organizationSkillAction}
            ariaLabel={t("chat.emptyOrganizationSkillsAria")}
            onClick={onOpenOrganizations}
          />
        ) : null}
      </div>
    </div>
  )
}

function EmptyCapabilityAction({
  actionLabel,
  ariaLabel,
  icon,
  meta,
  title,
  onClick,
}: {
  actionLabel: string
  ariaLabel: string
  icon: React.ReactNode
  meta: string
  title: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="group flex min-h-8 max-w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="oo-text-control flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-medium">{title}</span>
        <span className="shrink-0 opacity-60" aria-hidden="true">
          ·
        </span>
        <span className="min-w-0 truncate">{meta}</span>
      </span>
      <span className="oo-text-control ml-1 shrink-0 font-medium opacity-80 transition-opacity group-hover:opacity-100">
        {actionLabel}
      </span>
      <ChevronRight className="size-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-90" />
    </button>
  )
}

export const ChatArea = React.memo(function ChatArea({
  activeSessionId,
  billingCacheScope,
  composerDraftKey,
  composerFocusRequest,
  messages,
  permissionMode,
  pendingPermissions,
  pendingQuestions,
  status,
  activity,
  showEmptyState,
  bootstrapping,
  startupError,
  error,
  emptyTitle,
  generatedArtifacts,
  submitDisabled,
  initialComposerState,
  initialSendPending,
  providers,
  sharedConnectorCount,
  organizationSkillEntryVisible,
  organizationSkillPendingInstallCount,
  organizationSkillShowcaseItems,
  queueHeld,
  queuedMessages,
  placeholder,
  contextBar,
  organizationSkills,
  onComposerStateChange,
  onSend,
  onPermissionModeChange,
  onAnswerQuestion,
  onAnswerPermission,
  onContinueQuestion,
  onDiscardQuestion,
  onRejectQuestion,
  onSetDefaultConnection,
  onStop,
  onQueuedMessageMove,
  onQueuedMessageRemove,
  onQueuedMessageResume,
  onAuthorize,
  onArtifactsReset,
  onArtifactsOpen,
  onArtifactsAvailable,
  onTurnOutputOpen,
  onTurnOutputAvailable,
  onOpenConnections,
  onOpenConnectionProvider,
  onOpenOrganizations,
  onViewBilling,
}: ChatAreaProps) {
  const t = useT()
  const [fullAccessDialogOpen, setFullAccessDialogOpen] = React.useState(false)
  const hasMessages = messages.length > 0
  const isGenerating = status === "submitted" || status === "streaming"
  React.useEffect(() => {
    onArtifactsReset()
  }, [messages[0]?.id, onArtifactsReset])

  React.useEffect(() => {
    if (isGenerating) {
      onArtifactsReset()
    }
  }, [isGenerating, onArtifactsReset])

  const requestFullAccess = React.useCallback((): void => {
    if (permissionMode === "full_access") {
      return
    }
    setFullAccessDialogOpen(true)
  }, [permissionMode])

  const confirmFullAccess = React.useCallback((): void => {
    onPermissionModeChange("full_access")
    setFullAccessDialogOpen(false)
  }, [onPermissionModeChange])

  const showCenteredEmptyState = showEmptyState && !hasMessages && !isGenerating
  const composer = (
    <ChatComposer
      key={composerDraftKey}
      error={error}
      focusRequest={composerFocusRequest}
      generatedArtifacts={generatedArtifacts}
      hasMessages={hasMessages}
      initialComposerState={initialComposerState}
      initialSendPending={initialSendPending}
      messages={messages}
      permissionMode={permissionMode}
      pendingQuestions={pendingQuestions}
      placeholder={placeholder}
      contextBar={showCenteredEmptyState ? contextBar : undefined}
      organizationSkills={organizationSkills}
      providers={providers}
      queueHeld={queueHeld}
      queuedMessages={queuedMessages}
      status={status}
      submitDisabled={submitDisabled}
      onComposerStateChange={onComposerStateChange}
      onQueuedMessageMove={onQueuedMessageMove}
      onQueuedMessageRemove={onQueuedMessageRemove}
      onQueuedMessageResume={onQueuedMessageResume}
      onSend={onSend}
      onAnswerQuestion={onAnswerQuestion}
      onPermissionModeDefault={() => onPermissionModeChange("default")}
      onPermissionModeFullAccess={requestFullAccess}
      onSetDefaultConnection={onSetDefaultConnection}
      onOpenConnectionProvider={onOpenConnectionProvider}
      onStop={onStop}
      onViewBilling={onViewBilling}
    />
  )

  const content = startupError ? (
    <div
      className={cn("mx-auto grid min-h-full w-full place-items-center px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)}
    >
      <ErrorNotice error={startupError} />
    </div>
  ) : bootstrapping ? (
    <div className={cn("mx-auto min-h-full w-full px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)} aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-28 rounded-sm motion-safe:animate-none" />
        <Skeleton className="h-3.5 w-72 max-w-[68%] rounded-sm motion-safe:animate-none" />
        <Skeleton className="h-3.5 w-48 max-w-[52%] rounded-sm motion-safe:animate-none" />
      </div>
    </div>
  ) : showCenteredEmptyState ? (
    <div className="grid min-h-full w-full place-items-center px-4 py-6 sm:px-5 lg:px-8">
      <div
        className={cn(
          "flex w-full translate-y-[-2vh] flex-col gap-5 transition-transform duration-300 ease-out",
          EMPTY_COMPOSER_MAX_WIDTH_CLASS,
        )}
      >
        <div className="px-4 pb-1 text-center">
          <BrandIcon className="mx-auto mb-4 size-[72px]" aria-hidden="true" />
          <h2 className="oo-text-empty-title mx-auto max-w-2xl">{emptyTitle ?? t("chat.emptyTitle")}</h2>
        </div>
        <div className="flex flex-col gap-3">
          {composer}
          <EmptyStateActions
            organizationSkillEntryVisible={organizationSkillEntryVisible}
            organizationSkillPendingInstallCount={organizationSkillPendingInstallCount}
            organizationSkillShowcaseItems={organizationSkillShowcaseItems}
            sharedConnectorCount={sharedConnectorCount}
            onOpenConnections={onOpenConnections}
            onOpenOrganizations={onOpenOrganizations}
          />
        </div>
      </div>
    </div>
  ) : (
    <ChatTimeline
      activeSessionId={activeSessionId}
      billingCacheScope={billingCacheScope}
      messages={messages}
      pendingPermissions={pendingPermissions}
      pendingQuestions={pendingQuestions}
      status={status}
      activity={activity}
      isGenerating={isGenerating}
      providers={providers}
      onAuthorize={onAuthorize}
      onArtifactsOpen={onArtifactsOpen}
      onArtifactsAvailable={onArtifactsAvailable}
      onTurnOutputOpen={onTurnOutputOpen}
      onTurnOutputAvailable={onTurnOutputAvailable}
      onAnswerQuestion={onAnswerQuestion}
      onAnswerPermission={onAnswerPermission}
      onContinueQuestion={onContinueQuestion}
      onDiscardQuestion={onDiscardQuestion}
      onRejectQuestion={onRejectQuestion}
      onViewBilling={onViewBilling}
    />
  )

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col pb-4">
        <div className="flex min-h-0 flex-1 overflow-hidden">{content}</div>

        {showCenteredEmptyState ? null : (
          <div className={cn("mx-auto flex w-full flex-col gap-2 px-4", CHAT_CONTENT_MAX_WIDTH_CLASS)}>{composer}</div>
        )}
      </div>
      <FullAccessConfirmDialog
        open={fullAccessDialogOpen}
        onClose={() => setFullAccessDialogOpen(false)}
        onConfirm={confirmFullAccess}
      />
    </div>
  )
})
