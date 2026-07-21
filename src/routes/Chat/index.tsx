import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  AgentPermissionMode,
  ChatMessage,
  ChatTeamSkillContext,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatQuestionRequest,
} from "../../../electron/chat/common.ts"
import type { ChatErrorKind } from "../../../electron/chat/error.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"
import type { ConnectionCatalogFilter } from "../Connections/connection-route-model.ts"
import type { ChatTurnRetrySource } from "./chat-turns.ts"
import type { ComposerState } from "./composer-state.ts"
import type { EmptyStateConnectionSummary } from "./empty-state-connections.ts"
import type { QuestionDraftStore } from "./question-fields.ts"
import type { ChatSendRequest, ChatSendResult } from "@/components/app-shell/app-shell-model"
import type { QueuedChatMessage, QueuedMessageMovePlacement } from "@/components/app-shell/chat-queue"
import type { BillingRequestScope } from "@/lib/billing-client"
import type { UserFacingError } from "@/lib/user-facing-error"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"
import type { ChatStatus } from "ai"

import { Building2, ChevronRight, Package, PlugZap } from "lucide-react"
import * as React from "react"
import { BillingRequestScopeContext } from "./billing-request-scope-context.ts"
import { chatTurnShowsGenerating, resolveChatTurnState } from "./chat-turn-state.ts"
import { ChatComposer } from "./ChatComposer.tsx"
import { ChatTimeline } from "./ChatTimeline.tsx"
import { resolveCurrentToolsPresentation } from "./empty-state-connections.ts"
import { FullAccessConfirmDialog } from "./FullAccessConfirmDialog.tsx"
import { BrandIcon } from "@/components/BrandIcon"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ChatAreaProps {
  activeSessionId: string | null
  billingCacheScope: string
  billingRequestScope: BillingRequestScope | null
  composerDraftKey: string
  composerFocusRequest: number
  cloudModelsEnabled?: boolean
  messages: ChatMessage[]
  knowledgeBaseIds: string[]
  knowledgeEnabled: boolean
  knowledgeError: string | null
  knowledgeItems: KnowledgeBaseSummary[]
  knowledgeLoading: boolean
  modelRequired?: boolean
  permissionMode: AgentPermissionMode
  pendingPermissions: ChatPermissionRequest[]
  pendingQuestions: ChatQuestionRequest[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  showEmptyState: boolean
  bootstrapping: boolean
  startupError?: UserFacingError | null
  onStartupRetry?: () => void
  error: string | null
  emptyTitle?: string
  generatedArtifacts?: ArtifactSelection | null
  historyScope: string
  submitDisabled: boolean
  willQueueMessage: boolean
  initialComposerState?: ComposerState
  initialSendPending: boolean
  providers: ConnectionProvider[]
  queueHeld: boolean
  queuedMessages: QueuedChatMessage[]
  placeholder: string
  contextBar?: React.ReactNode
  pinnedContextBar?: React.ReactNode
  emptyStateConnectionSummary?: EmptyStateConnectionSummary | null
  canManageWorkspaceConnections: boolean
  teamSkillEntryVisible?: boolean
  teamSkillPendingInstallCount?: number
  teamSkillShowcaseItems?: TeamSkillShowcaseItem[]
  teamSkills?: ChatTeamSkillContext[]
  selfManagedSetup?: {
    onConfigureOpenConnector: () => void
    onDismiss: () => void
  }
  onSend: (request: ChatSendRequest) => Promise<ChatSendResult>
  onPermissionModeChange: (mode: AgentPermissionMode) => void
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>
  onAnswerPermission: (requestId: string, reply: ChatPermissionReply) => Promise<void>
  onRejectQuestion: (requestId: string) => Promise<void>
  questionDrafts: QuestionDraftStore
  onStop: () => Promise<void> | void
  onComposerStateChange?: (state: ComposerState) => void
  onQueuedMessageMove: (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => void
  onQueuedMessageRemove: (id: string) => void
  onQueuedMessageResume: () => void
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onRecover: (kind: ChatErrorKind, source: ChatTurnRetrySource) => Promise<void>
  onRetryFresh: (source: ChatTurnRetrySource) => Promise<void>
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onTurnOutputAvailable: (selection: TurnOutputSelection) => void
  onOpenConnections?: (filter?: ConnectionCatalogFilter) => void
  onOpenConnectionProvider?: (service: string, displayName: string) => void
  onOpenKnowledgeLibrary?: () => void
  onOpenTeams?: () => void
  onViewBilling?: () => void
  onSelectKnowledgeBase: (id: string) => void
}

const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const EMPTY_COMPOSER_MAX_WIDTH_CLASS = "min-w-0 max-w-[47.5rem]"
interface TeamSkillShowcaseItem {
  id: string
  name: string
}

function EmptyStateActions({
  canManageWorkspaceConnections,
  connectionSummary,
  teamSkillEntryVisible = false,
  teamSkillPendingInstallCount,
  teamSkillShowcaseItems = [],
  onOpenConnections,
  onOpenTeams,
}: {
  teamSkillEntryVisible?: boolean
  teamSkillPendingInstallCount?: number
  teamSkillShowcaseItems?: TeamSkillShowcaseItem[]
  canManageWorkspaceConnections: boolean
  connectionSummary?: EmptyStateConnectionSummary | null
  onOpenConnections?: (filter?: ConnectionCatalogFilter) => void
  onOpenTeams?: () => void
}) {
  const t = useT()
  if (!onOpenConnections) return null
  const currentTools = resolveCurrentToolsPresentation(connectionSummary)
  const pendingTeamSkillCount = teamSkillPendingInstallCount ?? teamSkillShowcaseItems.length
  const teamSkillMeta =
    pendingTeamSkillCount > 0
      ? t("chat.emptyTeamSkillsMeta", { count: pendingTeamSkillCount })
      : t("chat.emptyTeamSkillsRecommendedMeta", { count: teamSkillShowcaseItems.length })
  const teamSkillAction =
    pendingTeamSkillCount > 0 ? t("chat.emptyTeamSkillsAction") : t("chat.emptyTeamSkillsViewAction")
  const hasPendingTeamSkills = pendingTeamSkillCount > 0

  return (
    <div className="w-full pl-2 text-muted-foreground">
      <div className="grid min-w-0 justify-start gap-1">
        <EmptyCapabilityAction
          icon={<Building2 className="size-4" />}
          title={t(currentTools.titleKey)}
          meta={t(currentTools.meta.key, currentTools.meta.vars)}
          actionLabel={t(currentTools.actionKey)}
          ariaLabel={t(currentTools.ariaLabelKey)}
          highlighted={currentTools.highlighted}
          onClick={() => onOpenConnections?.(currentTools.targetFilter)}
        />
        <EmptyCapabilityAction
          icon={<PlugZap className="size-4" />}
          title={t("chat.emptyMoreConnectorsTitle")}
          meta={t("chat.emptyMoreConnectorsMeta")}
          actionLabel={
            canManageWorkspaceConnections
              ? t("chat.emptyMoreConnectorsAddAction")
              : t("chat.emptyMoreConnectorsBrowseAction")
          }
          ariaLabel={t("chat.emptyConnectorsAria")}
          onClick={() => onOpenConnections?.({ kind: "all" })}
        />
        {teamSkillEntryVisible ? (
          <EmptyCapabilityAction
            icon={<Package className="size-4" />}
            title={t("chat.emptyTeamSkillsTitle")}
            meta={teamSkillMeta}
            actionLabel={teamSkillAction}
            ariaLabel={t("chat.emptyTeamSkillsAria")}
            highlighted={hasPendingTeamSkills}
            onClick={onOpenTeams}
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
  highlighted = false,
  onClick,
}: {
  actionLabel: string
  ariaLabel: string
  highlighted?: boolean
  icon: React.ReactNode
  meta: string
  title: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="group -ml-2 flex min-h-8 max-w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="oo-text-control flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span className="font-medium">{title}</span>
        <span className="shrink-0 opacity-60" aria-hidden="true">
          ·
        </span>
        {highlighted ? (
          <span className="oo-pending-skill-status">
            <span className="oo-pending-skill-dot" aria-hidden="true" />
            <span>{meta}</span>
          </span>
        ) : (
          <span>{meta}</span>
        )}
      </span>
      <span
        className={cn(
          "oo-text-control ml-1 shrink-0 font-medium opacity-80 transition-[color,opacity] group-hover:opacity-100",
          highlighted && "oo-pending-skill-action",
        )}
      >
        {actionLabel}
      </span>
      <ChevronRight className="size-3.5 shrink-0 opacity-55 transition-[opacity,transform] group-hover:translate-x-px group-hover:opacity-90" />
    </button>
  )
}

export const ChatArea = React.memo(function ChatArea({
  activeSessionId,
  billingCacheScope,
  billingRequestScope,
  composerDraftKey,
  composerFocusRequest,
  cloudModelsEnabled = true,
  messages,
  knowledgeBaseIds,
  knowledgeEnabled,
  knowledgeError,
  knowledgeItems,
  knowledgeLoading,
  modelRequired = false,
  permissionMode,
  pendingPermissions,
  pendingQuestions,
  status,
  activity,
  showEmptyState,
  bootstrapping,
  startupError,
  onStartupRetry,
  error,
  emptyTitle,
  generatedArtifacts,
  historyScope,
  submitDisabled,
  willQueueMessage,
  initialComposerState,
  initialSendPending,
  providers,
  emptyStateConnectionSummary,
  canManageWorkspaceConnections,
  teamSkillEntryVisible,
  teamSkillPendingInstallCount,
  teamSkillShowcaseItems,
  queueHeld,
  queuedMessages,
  placeholder,
  contextBar,
  pinnedContextBar,
  teamSkills,
  selfManagedSetup,
  onComposerStateChange,
  onSend,
  onPermissionModeChange,
  onAnswerQuestion,
  onAnswerPermission,
  onRejectQuestion,
  questionDrafts,
  onStop,
  onQueuedMessageMove,
  onQueuedMessageRemove,
  onQueuedMessageResume,
  onAuthorize,
  onRecover,
  onRetryFresh,
  onArtifactsOpen,
  onArtifactsAvailable,
  onTurnOutputOpen,
  onTurnOutputAvailable,
  onOpenConnections,
  onOpenConnectionProvider,
  onOpenKnowledgeLibrary,
  onOpenTeams,
  onViewBilling,
  onSelectKnowledgeBase,
}: ChatAreaProps) {
  const t = useT()
  const [fullAccessDialogOpen, setFullAccessDialogOpen] = React.useState(false)
  const hasMessages = messages.length > 0
  const activeQuestionCount = pendingQuestions.length
  const turnState = resolveChatTurnState({
    initialSendPending,
    pendingPermissionCount: pendingPermissions.length,
    pendingQuestionCount: activeQuestionCount,
    status,
  })
  const isGenerating = chatTurnShowsGenerating(turnState)

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
      cloudModelsEnabled={cloudModelsEnabled}
      error={error}
      focusRequest={composerFocusRequest}
      generatedArtifacts={generatedArtifacts}
      hasMessages={hasMessages}
      historyScope={historyScope}
      initialComposerState={initialComposerState}
      messages={messages}
      knowledgeBaseIds={knowledgeBaseIds}
      knowledgeEnabled={knowledgeEnabled}
      knowledgeError={knowledgeError}
      knowledgeItems={knowledgeItems}
      knowledgeLoading={knowledgeLoading}
      modelRequired={modelRequired}
      permissionMode={permissionMode}
      pendingQuestions={pendingQuestions}
      placeholder={placeholder}
      contextBar={showCenteredEmptyState ? contextBar : undefined}
      teamSkills={teamSkills}
      providers={providers}
      queueHeld={queueHeld}
      queuedMessages={queuedMessages}
      turnState={turnState}
      submitDisabled={submitDisabled}
      willQueueMessage={willQueueMessage}
      onComposerStateChange={onComposerStateChange}
      onQueuedMessageMove={onQueuedMessageMove}
      onQueuedMessageRemove={onQueuedMessageRemove}
      onQueuedMessageResume={onQueuedMessageResume}
      onSend={onSend}
      onAnswerQuestion={onAnswerQuestion}
      onPermissionModeDefault={() => onPermissionModeChange("default")}
      onPermissionModeFullAccess={requestFullAccess}
      onOpenConnectionProvider={onOpenConnectionProvider}
      onOpenKnowledgeLibrary={onOpenKnowledgeLibrary}
      selfManagedSetup={selfManagedSetup}
      onSelectKnowledgeBase={onSelectKnowledgeBase}
      onStop={onStop}
      onViewBilling={onViewBilling}
    />
  )

  const content = startupError ? (
    <div
      className={cn("mx-auto grid min-h-full w-full place-items-center px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)}
    >
      <ErrorNotice
        error={startupError}
        action={onStartupRetry ? { label: t("teams.retry"), onClick: onStartupRetry } : undefined}
      />
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
          {pinnedContextBar}
          {composer}
          <EmptyStateActions
            canManageWorkspaceConnections={canManageWorkspaceConnections}
            connectionSummary={emptyStateConnectionSummary}
            teamSkillEntryVisible={teamSkillEntryVisible}
            teamSkillPendingInstallCount={teamSkillPendingInstallCount}
            teamSkillShowcaseItems={teamSkillShowcaseItems}
            onOpenConnections={onOpenConnections}
            onOpenTeams={onOpenTeams}
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
      onRecover={onRecover}
      onRetryFresh={onRetryFresh}
      onArtifactsOpen={onArtifactsOpen}
      onArtifactsAvailable={onArtifactsAvailable}
      onTurnOutputOpen={onTurnOutputOpen}
      onTurnOutputAvailable={onTurnOutputAvailable}
      onAnswerQuestion={onAnswerQuestion}
      onAnswerPermission={onAnswerPermission}
      onRejectQuestion={onRejectQuestion}
      questionDrafts={questionDrafts}
      onViewBilling={onViewBilling}
    />
  )

  return (
    <BillingRequestScopeContext.Provider value={billingRequestScope}>
      <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col pb-4">
          <div className="flex min-h-0 flex-1 overflow-hidden">{content}</div>

          {showCenteredEmptyState ? null : (
            <div className={cn("mx-auto flex w-full flex-col gap-2 px-4", CHAT_CONTENT_MAX_WIDTH_CLASS)}>
              {pinnedContextBar}
              {composer}
            </div>
          )}
        </div>
        <FullAccessConfirmDialog
          open={fullAccessDialogOpen}
          onClose={() => setFullAccessDialogOpen(false)}
          onConfirm={confirmFullAccess}
        />
      </div>
    </BillingRequestScopeContext.Provider>
  )
})
