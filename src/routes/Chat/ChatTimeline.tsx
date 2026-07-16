import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatQuestionRequest,
  ChatMessage,
  TurnOutputRecord,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ResolvedArtifactGroup } from "./artifact-resolution.ts"
import type { ChatTurn, ChatTurnRetrySource } from "./chat-turns.ts"
import type { QuestionDraftStore } from "./question-fields.ts"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"
import type { ChatStatus } from "ai"
import type { StickToBottomContext } from "use-stick-to-bottom"

import * as React from "react"
import { useArtifactBundles } from "./artifact-bundle-records.ts"
import { shouldRenderGeneratedArtifactsShelf } from "./artifact-shelf-visibility.ts"
import { splitAssistantTimelineBlocks, textFromTimelineBlocks } from "./assistant-timeline.ts"
import { shouldRenderConnectionSuggestion } from "./assistant-turn-renderer-model.ts"
import { TurnProcessActivity } from "./AssistantTurnRenderer.tsx"
import {
  activityForChatTurn,
  assistantMessageIdsKey,
  groupChatTurns,
  latestAssistantMessage,
  retrySourceFromTurn,
  reuseStableChatTurns,
  shouldShowPlainTurnActivity,
  shouldShowSuggestedAuthorization,
  shouldShowTurnProcess,
  summarizeTurnProcess,
} from "./chat-turns.ts"
import {
  AssistantMessageActions,
  ConnectionAuthorizationIssueAction,
  ConnectionSuggestionAction,
} from "./ChatMessageActions.tsx"
import { AssistantTimelineMessage, MessageBubble, PlainAssistantActivity } from "./ChatMessageBubble.tsx"
import { assistantResponseActionTextByMessageId } from "./message-text.ts"
import { PermissionRequiredCard } from "./PermissionRequiredCard.tsx"
import { QuestionPromptCard } from "./QuestionPromptCard.tsx"
import { normalizeServiceSlug } from "./tool-display.ts"
import { hasStoppedTool } from "./tool-state.ts"
import {
  turnOutputInitialRole,
  turnOutputRecordsByMessageId,
  turnOutputRecordsByTurnId,
  useTurnOutputRecords,
} from "./turn-output-records.ts"
import { TurnOutputShelf } from "./TurnOutputShelf.tsx"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { cn } from "@/lib/utils"

const GeneratedArtifacts = React.lazy(() =>
  import("@/routes/Chat/GeneratedArtifacts").then((module) => ({ default: module.GeneratedArtifacts })),
)
const CHAT_CONTENT_MAX_WIDTH_CLASS = "min-w-0 max-w-[50rem]"
const ASSISTANT_TEXT_SMOOTH_WINDOW_MS = 45_000

const EMPTY_ARTIFACT_GROUPS: ResolvedArtifactGroup[] = []

function noopArtifactsAvailable(_selection: ArtifactSelection): void {
  // 只有最新的产物需要自动成为右侧面板的默认选择。
}

function artifactGroupArraysEqual(
  left: readonly ResolvedArtifactGroup[],
  right: readonly ResolvedArtifactGroup[],
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function reuseStableArtifactGroupMap(
  previous: Map<string, ResolvedArtifactGroup[]>,
  next: Map<string, ResolvedArtifactGroup[]>,
): Map<string, ResolvedArtifactGroup[]> {
  let changed = previous.size !== next.size
  const stable = new Map<string, ResolvedArtifactGroup[]>()
  for (const [key, groups] of next) {
    const previousGroups = previous.get(key)
    const stableGroups = previousGroups && artifactGroupArraysEqual(previousGroups, groups) ? previousGroups : groups
    stable.set(key, stableGroups)
    if (stableGroups !== previousGroups) {
      changed = true
    }
  }
  return changed ? stable : previous
}

interface ChatTurnViewProps {
  activeSessionId: string | null
  artifactGroups: ResolvedArtifactGroup[]
  billingCacheScope: string
  turnOutputRecord: TurnOutputRecord | null
  turn: ChatTurn
  activity: AssistantActivityEvent | null
  activeAssistantMessageId?: string
  smoothAssistantMessageId?: string
  providerByService: Map<string, ConnectionProvider>
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onRetryFresh: (source: ChatTurnRetrySource) => Promise<void>
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onViewBilling?: () => void
}

function chatTurnViewPropsEqual(previous: ChatTurnViewProps, next: ChatTurnViewProps): boolean {
  return (
    previous.activeSessionId === next.activeSessionId &&
    previous.artifactGroups === next.artifactGroups &&
    previous.billingCacheScope === next.billingCacheScope &&
    previous.turnOutputRecord === next.turnOutputRecord &&
    previous.turn === next.turn &&
    previous.activity === next.activity &&
    previous.activeAssistantMessageId === next.activeAssistantMessageId &&
    previous.smoothAssistantMessageId === next.smoothAssistantMessageId &&
    previous.providerByService === next.providerByService &&
    previous.onAuthorize === next.onAuthorize &&
    previous.onRetryFresh === next.onRetryFresh &&
    previous.onArtifactsAvailable === next.onArtifactsAvailable &&
    previous.onArtifactsOpen === next.onArtifactsOpen &&
    previous.onTurnOutputOpen === next.onTurnOutputOpen &&
    previous.onViewBilling === next.onViewBilling
  )
}

const ChatTurnView = React.memo(function ChatTurnView({
  activeSessionId,
  artifactGroups,
  billingCacheScope,
  turnOutputRecord,
  turn,
  activity,
  activeAssistantMessageId,
  smoothAssistantMessageId,
  providerByService,
  onAuthorize,
  onRetryFresh,
  onArtifactsAvailable,
  onArtifactsOpen,
  onTurnOutputOpen,
  onViewBilling,
}: ChatTurnViewProps) {
  const process = summarizeTurnProcess(turn, activity, activeAssistantMessageId)
  const { processBlocks, responseBlocks } = splitAssistantTimelineBlocks(turn.assistants)
  const shouldShowProcess = shouldShowTurnProcess(process)
  const shouldShowPlainActivity = shouldShowPlainTurnActivity(process)
  const turnIsActive = Boolean(activeAssistantMessageId)
  const processSeenRef = React.useRef(shouldShowProcess)
  if (shouldShowProcess) {
    processSeenRef.current = true
  } else if (!turnIsActive) {
    processSeenRef.current = false
  }
  const showTurnProcess = shouldShowProcess || (turnIsActive && processSeenRef.current)
  const processRenderBlocks = showTurnProcess && processBlocks.length === 0 ? responseBlocks : processBlocks
  const responseRenderBlocks = showTurnProcess && processBlocks.length === 0 ? [] : responseBlocks
  const processLive = showTurnProcess && turnIsActive
  const lastAssistant = turn.assistants.at(-1)
  const assistantActionTextByMessageId = React.useMemo(
    () => assistantResponseActionTextByMessageId(turn.assistants, activeAssistantMessageId),
    [activeAssistantMessageId, turn.assistants],
  )
  const assistantActionsText = lastAssistant ? assistantActionTextByMessageId.get(lastAssistant.id) : null
  const assistantCancelled = turn.assistants.some((message) => hasStoppedTool(message.parts))
  const responseActionsText =
    lastAssistant?.id === activeAssistantMessageId ? null : textFromTimelineBlocks(responseRenderBlocks) || null
  const processActionsText = responseRenderBlocks.length > 0 ? null : assistantActionsText
  const hasRenderableArtifacts = shouldRenderGeneratedArtifactsShelf(artifactGroups)
  const hasRenderableTurnOutputs = Boolean(
    activeSessionId &&
    turnOutputRecord &&
    turnOutputRecord.files.some((file) => file.role === "process" || file.role === "project_change"),
  )
  const showSuggestedAuthorization = shouldShowSuggestedAuthorization(process, turnIsActive)
  const suggestedAuthorization = shouldRenderConnectionSuggestion(
    showSuggestedAuthorization ? process.suggestedAuthorization : undefined,
    providerByService,
  )
  const responseSuggestedAuthorization =
    suggestedAuthorization && responseRenderBlocks.length > 0 ? suggestedAuthorization : undefined
  const processSuggestedAuthorization =
    suggestedAuthorization && responseRenderBlocks.length === 0 ? suggestedAuthorization : undefined
  const retrySource = React.useMemo(() => retrySourceFromTurn(turn), [turn])
  const handleAuthorize = React.useCallback(
    (auth: AuthorizationInfo) => {
      onAuthorize(auth, retrySource ?? undefined)
    },
    [onAuthorize, retrySource],
  )
  const handleRetryFresh = React.useCallback(
    () => (retrySource ? onRetryFresh(retrySource) : Promise.resolve()),
    [onRetryFresh, retrySource],
  )

  return (
    <React.Fragment>
      {turn.user ? (
        <MessageBubble
          message={turn.user}
          billingCacheScope={billingCacheScope}
          smoothText={false}
          onViewBilling={onViewBilling}
          assistantActionsText={null}
          providerByService={providerByService}
          onAuthorize={handleAuthorize}
          onRetryFresh={retrySource ? handleRetryFresh : undefined}
        />
      ) : null}
      {showTurnProcess ? (
        <>
          <Message from="assistant">
            <MessageContent className="w-full">
              <TurnProcessActivity
                blocks={processRenderBlocks}
                process={process}
                live={processLive}
                billingCacheScope={billingCacheScope}
                providerByService={providerByService}
                onAuthorize={handleAuthorize}
                onRetryFresh={retrySource ? handleRetryFresh : undefined}
                onViewBilling={onViewBilling}
              />
              {!processLive
                ? process.authorizationIssues.map((issue) => (
                    <ConnectionAuthorizationIssueAction
                      key={issue.key}
                      issue={issue}
                      provider={providerByService.get(issue.service)}
                      onAuthorize={handleAuthorize}
                    />
                  ))
                : null}
              {processSuggestedAuthorization ? (
                <ConnectionSuggestionAction
                  authorization={processSuggestedAuthorization}
                  provider={providerByService.get(normalizeServiceSlug(processSuggestedAuthorization.service))}
                  onAuthorize={handleAuthorize}
                />
              ) : null}
            </MessageContent>
            {processActionsText || (assistantCancelled && responseRenderBlocks.length === 0) ? (
              <AssistantMessageActions text={processActionsText ?? ""} cancelled={assistantCancelled} />
            ) : null}
          </Message>
          {responseRenderBlocks.length > 0 ? (
            <AssistantTimelineMessage
              blocks={responseRenderBlocks}
              billingCacheScope={billingCacheScope}
              smoothAssistantMessageId={smoothAssistantMessageId}
              assistantActionsText={responseActionsText}
              assistantCancelled={assistantCancelled}
              activeAssistantMessageId={activeAssistantMessageId}
              providerByService={providerByService}
              onAuthorize={handleAuthorize}
              onRetryFresh={retrySource ? handleRetryFresh : undefined}
              suggestedAuthorization={responseSuggestedAuthorization}
              onViewBilling={onViewBilling}
            />
          ) : null}
        </>
      ) : (
        <>
          {shouldShowPlainActivity ? <PlainAssistantActivity /> : null}
          {turn.assistants.map((message) => (
            <MessageBubble
              key={message.clientId ?? message.id}
              message={message}
              billingCacheScope={billingCacheScope}
              smoothText={message.id === smoothAssistantMessageId}
              onViewBilling={onViewBilling}
              assistantActionsText={assistantActionTextByMessageId.get(message.id) ?? null}
              providerByService={providerByService}
              liveTools={message.id === activeAssistantMessageId}
              onAuthorize={handleAuthorize}
              onRetryFresh={retrySource ? handleRetryFresh : undefined}
              suggestedAuthorization={message.id === lastAssistant?.id ? process.suggestedAuthorization : undefined}
            />
          ))}
        </>
      )}
      {hasRenderableArtifacts || hasRenderableTurnOutputs ? (
        <div className="mt-2 grid gap-2">
          {hasRenderableArtifacts ? (
            <React.Suspense fallback={null}>
              <GeneratedArtifacts groups={artifactGroups} onOpen={onArtifactsOpen} onAvailable={onArtifactsAvailable} />
            </React.Suspense>
          ) : null}
          {hasRenderableTurnOutputs && turnOutputRecord ? (
            <TurnOutputShelf record={turnOutputRecord} onOpen={onTurnOutputOpen} />
          ) : null}
        </div>
      ) : null}
    </React.Fragment>
  )
}, chatTurnViewPropsEqual)

function chatTurnHasAssistantMessage(turn: ChatTurn, messageId: string | undefined): boolean {
  return Boolean(messageId && turn.assistants.some((message) => message.id === messageId))
}

interface ChatTimelineProps {
  activeSessionId: string | null
  billingCacheScope: string
  messages: ChatMessage[]
  pendingPermissions: ChatPermissionRequest[]
  pendingQuestions: ChatQuestionRequest[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  isGenerating: boolean
  providers: ConnectionProvider[]
  onAuthorize: (auth: AuthorizationInfo, source?: ChatTurnRetrySource) => void
  onRetryFresh: (source: ChatTurnRetrySource) => Promise<void>
  onArtifactsOpen: (selection: ArtifactSelection) => void
  onArtifactsAvailable: (selection: ArtifactSelection) => void
  onTurnOutputOpen: (selection: TurnOutputSelection) => void
  onTurnOutputAvailable: (selection: TurnOutputSelection) => void
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>
  onAnswerPermission: (requestId: string, reply: ChatPermissionReply) => Promise<void>
  onRejectQuestion: (requestId: string) => Promise<void>
  questionDrafts: QuestionDraftStore
  onViewBilling?: () => void
}

export const ChatTimeline = React.memo(function ChatTimeline({
  activeSessionId,
  billingCacheScope,
  messages,
  pendingPermissions = [],
  pendingQuestions = [],
  status,
  activity,
  isGenerating,
  providers,
  onAuthorize,
  onRetryFresh,
  onArtifactsOpen,
  onArtifactsAvailable,
  onTurnOutputOpen,
  onTurnOutputAvailable,
  onAnswerQuestion,
  onAnswerPermission,
  onRejectQuestion,
  questionDrafts,
  onViewBilling,
}: ChatTimelineProps) {
  const conversationRef = React.useRef<StickToBottomContext | null>(null)
  const lastAutoScrolledUserMessageIdRef = React.useRef<string | null>(null)
  const stableTurnsRef = React.useRef<ChatTurn[]>([])
  const artifactGroupsByMessageIdRef = React.useRef<Map<string, ResolvedArtifactGroup[]>>(new Map())
  const artifactGroupsByTurnIdRef = React.useRef<Map<string, ResolvedArtifactGroup[]>>(new Map())
  const latestAssistant = React.useMemo(() => latestAssistantMessage(messages), [messages])
  const groupedTurns = React.useMemo(() => groupChatTurns(messages), [messages])
  const turns = React.useMemo(() => {
    const stableTurns = reuseStableChatTurns(stableTurnsRef.current, groupedTurns)
    stableTurnsRef.current = stableTurns
    return stableTurns
  }, [groupedTurns])
  const messageIdsKey = React.useMemo(() => assistantMessageIdsKey(messages), [messages])
  const artifactBundles = useArtifactBundles(activeSessionId, messageIdsKey)
  const turnOutputRecords = useTurnOutputRecords(activeSessionId, messageIdsKey)
  const turnOutputRecordsByMessage = React.useMemo(
    () => turnOutputRecordsByMessageId(turnOutputRecords),
    [turnOutputRecords],
  )
  const turnOutputRecordsByTurn = React.useMemo(
    () => turnOutputRecordsByTurnId(turns, turnOutputRecordsByMessage),
    [turnOutputRecordsByMessage, turns],
  )
  const latestTurnOutputRecord = turnOutputRecords.at(-1)
  const providerByService = React.useMemo(
    () => new Map(providers.map((provider) => [normalizeServiceSlug(provider.service), provider])),
    [providers],
  )
  const answerPermissionSafely = React.useCallback(
    (requestId: string, reply: ChatPermissionReply): void => {
      void onAnswerPermission(requestId, reply).catch(() => undefined)
    },
    [onAnswerPermission],
  )
  const activeAssistantMessageId =
    status === "streaming" && latestAssistant && !hasStoppedTool(latestAssistant.parts) ? latestAssistant.id : undefined
  const smoothAssistantMessageId = React.useMemo(() => {
    if (!latestAssistant || hasStoppedTool(latestAssistant.parts)) {
      return undefined
    }
    if (activeAssistantMessageId) {
      return activeAssistantMessageId
    }
    const ageMs = Date.now() - latestAssistant.createdAt
    return ageMs >= 0 && ageMs <= ASSISTANT_TEXT_SMOOTH_WINDOW_MS ? latestAssistant.id : undefined
  }, [activeAssistantMessageId, latestAssistant])
  const visibleArtifactGroups = React.useMemo<ResolvedArtifactGroup[]>(
    () =>
      artifactBundles.map((bundle) => ({
        messageId: bundle.messageId,
        group: {
          root: {
            path: bundle.rootPath,
            name: bundle.rootPath.split(/[\\/]/u).pop() ?? bundle.rootPath,
            kind: "directory" as const,
            mime: "inode/directory",
          },
          items: bundle.items,
          totalItems: bundle.totalItems,
          truncated: bundle.truncated,
        },
        status: bundle.status,
        ...(bundle.failure ? { failure: bundle.failure } : {}),
      })),
    [artifactBundles],
  )
  const artifactGroupsByMessageId = React.useMemo(() => {
    const byMessageId = new Map<string, ResolvedArtifactGroup[]>()
    for (const group of visibleArtifactGroups) {
      const groups = byMessageId.get(group.messageId) ?? []
      groups.push(group)
      byMessageId.set(group.messageId, groups)
    }
    const stable = reuseStableArtifactGroupMap(artifactGroupsByMessageIdRef.current, byMessageId)
    artifactGroupsByMessageIdRef.current = stable
    return stable
  }, [visibleArtifactGroups])
  const artifactGroupsByTurnId = React.useMemo(() => {
    const byTurnId = new Map<string, ResolvedArtifactGroup[]>()
    for (const turn of turns) {
      const groups = turn.assistants.flatMap((message) => artifactGroupsByMessageId.get(message.id) ?? [])
      if (groups.length > 0) {
        byTurnId.set(turn.id, groups)
      }
    }
    const stable = reuseStableArtifactGroupMap(artifactGroupsByTurnIdRef.current, byTurnId)
    artifactGroupsByTurnIdRef.current = stable
    return stable
  }, [artifactGroupsByMessageId, turns])
  const latestArtifactGroupMessageId = visibleArtifactGroups.at(-1)?.messageId
  React.useEffect(() => {
    if (latestTurnOutputRecord) {
      onTurnOutputAvailable({
        record: latestTurnOutputRecord,
        initialRole: turnOutputInitialRole(latestTurnOutputRecord),
      })
    }
  }, [latestTurnOutputRecord, onTurnOutputAvailable])

  React.useEffect(() => {
    const lastMessage = messages.at(-1)
    if (
      !isGenerating ||
      !lastMessage ||
      lastMessage.role !== "user" ||
      lastMessage.id === lastAutoScrolledUserMessageIdRef.current
    ) {
      return
    }
    lastAutoScrolledUserMessageIdRef.current = lastMessage.id
    void conversationRef.current?.scrollToBottom({
      animation: "instant",
      ignoreEscapes: true,
    })
  }, [isGenerating, messages])

  return (
    <Conversation className="min-h-0 flex-1" contextRef={conversationRef}>
      <ConversationContent
        data-selectable="true"
        className={cn("mx-auto min-h-full w-full gap-4 px-4 pt-7 pb-9", CHAT_CONTENT_MAX_WIDTH_CLASS)}
      >
        {turns.map((turn, index) => {
          const turnArtifactGroups = artifactGroupsByTurnId.get(turn.id) ?? EMPTY_ARTIFACT_GROUPS
          const publishArtifactAvailability =
            turnArtifactGroups.length > 0 &&
            turn.assistants.some((message) => message.id === latestArtifactGroupMessageId)
          const turnActiveAssistantMessageId = chatTurnHasAssistantMessage(turn, activeAssistantMessageId)
            ? activeAssistantMessageId
            : undefined
          const turnSmoothAssistantMessageId = chatTurnHasAssistantMessage(turn, smoothAssistantMessageId)
            ? smoothAssistantMessageId
            : undefined
          return (
            <div key={turn.id} className="oo-chat-turn-render-boundary grid min-w-0 gap-4">
              <ChatTurnView
                activeSessionId={activeSessionId}
                artifactGroups={turnArtifactGroups}
                turn={turn}
                billingCacheScope={billingCacheScope}
                turnOutputRecord={turnOutputRecordsByTurn.get(turn.id) ?? null}
                activity={activityForChatTurn(turn, activity, activeAssistantMessageId, index === turns.length - 1)}
                activeAssistantMessageId={turnActiveAssistantMessageId}
                smoothAssistantMessageId={turnSmoothAssistantMessageId}
                providerByService={providerByService}
                onAuthorize={onAuthorize}
                onRetryFresh={onRetryFresh}
                onArtifactsOpen={onArtifactsOpen}
                onArtifactsAvailable={publishArtifactAvailability ? onArtifactsAvailable : noopArtifactsAvailable}
                onTurnOutputOpen={onTurnOutputOpen}
                onViewBilling={onViewBilling}
              />
            </div>
          )
        })}
        {pendingQuestions.map((request) => (
          <div key={request.id} className="flex justify-start">
            <div className="w-full max-w-full">
              <QuestionPromptCard
                request={request}
                busy={status === "submitted"}
                onAnswer={onAnswerQuestion}
                onReject={onRejectQuestion}
                questionDrafts={questionDrafts}
              />
            </div>
          </div>
        ))}
        {pendingPermissions.map((request) => (
          <div key={request.id} className="flex justify-start">
            <div className="w-full max-w-full">
              <PermissionRequiredCard
                request={request}
                busy={status === "submitted"}
                onAllowOnce={(requestId) => answerPermissionSafely(requestId, "once")}
                onAllowForSession={(requestId) => answerPermissionSafely(requestId, "always")}
                onReject={(requestId) => answerPermissionSafely(requestId, "reject")}
              />
            </div>
          </div>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
})
