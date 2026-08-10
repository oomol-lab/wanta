import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalog, ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ChatTurnState } from "./chat-turn-state.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { ListPlus, Loader2, RotateCcw, Square, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { composerSubmitState, composerVoiceControlMode } from "./composer-controls.ts"
import { ComposerModeControls } from "./ComposerModeControls.tsx"
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { appCommandAriaShortcut, appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

interface ComposerTrailingControlsProps {
  canSubmit: boolean
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  turnState: ChatTurnState
  modelCatalog: ModelCatalog | null
  modelRequired?: boolean
  agentCatalog?: ExternalAgentCatalog
  agentEffortId?: string
  agentEffortSelectionEnabled?: boolean
  agentKind?: AgentKind
  agentMode: AgentMode
  agentModelId?: string
  agentModelSelectionEnabled?: boolean
  agentModesEnabled?: boolean
  agentPickerLocked?: boolean
  externalAgents?: ExternalAgentRuntimeStatus[]
  modelRoutingEnabled?: boolean
  permissionMode: AgentPermissionMode
  permissionModes?: readonly AgentPermissionMode[]
  reasoningLevel: ReasoningLevel
  voiceEnabled: boolean
  voiceActive: boolean
  voiceBars: readonly number[]
  voiceDurationMs: number
  voiceError: string | null
  voiceRecorderError?: string
  voiceRetryBlob: Blob | null
  voiceStarting: boolean
  voiceTranscribing: boolean
  willQueueMessage: boolean
  onAddModel: () => void
  onAgentPickerOpen?: () => void
  onCancelVoice: () => void
  onDeleteModel: (id: string) => void
  onRetryVoice: () => void
  onSelectAgentEffort?: (effortId?: string) => void
  onSelectAgentKind?: (kind: AgentKind) => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectAgentModel?: (modelId?: string) => void
  onSelectPermissionMode: (mode: AgentPermissionMode) => void
  onRequestFullAccessPermissionMode: () => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
  onStartVoice: () => void
  onStop: () => Promise<void> | void
  onStopVoice: () => void
}

function voiceDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function VoiceWaveCanvas({ bars, height = 32 }: { bars: readonly number[]; height?: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const metricsRef = React.useRef({
    canvasHeight: 1,
    dpr: 1,
    fillStyle: "#18181b",
    width: 1,
  })
  const [measurementRevision, setMeasurementRevision] = React.useState(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const updateMeasurement = (): void => setMeasurementRevision((revision) => revision + 1)
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateMeasurement)
    const themeObserver = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(updateMeasurement)
    resizeObserver?.observe(canvas)
    themeObserver?.observe(document.documentElement, {
      attributeFilter: ["class", "data-theme"],
      attributes: true,
    })
    return () => {
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
    }
  }, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(rect.width * dpr))
    const canvasHeight = Math.max(1, Math.floor(height * dpr))
    metricsRef.current = {
      canvasHeight,
      dpr,
      fillStyle: getComputedStyle(canvas).color || "#18181b",
      width,
    }
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== canvasHeight) {
      canvas.height = canvasHeight
    }
  }, [height, measurementRevision])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext("2d")
    if (!context) {
      return
    }

    const { canvasHeight, dpr, fillStyle, width } = metricsRef.current
    context.clearRect(0, 0, width, canvasHeight)
    context.fillStyle = fillStyle

    const barWidth = 3 * dpr
    const gap = 3 * dpr
    const step = barWidth + gap
    const centerY = canvasHeight / 2
    const drawableHeight = canvasHeight - 8 * dpr
    const visibleCount = Math.max(1, Math.ceil(width / step))
    const recentBars = bars.slice(-visibleCount)
    const visibleBars =
      recentBars.length >= visibleCount
        ? recentBars
        : [...Array<number>(visibleCount - recentBars.length).fill(0), ...recentBars]

    visibleBars.forEach((bar, index) => {
      const normalized = Math.max(0, Math.min(1, bar))
      const barHeight = Math.max(3 * dpr, normalized * drawableHeight)
      const x = index * step
      const y = centerY - barHeight / 2
      context.globalAlpha = 0.35 + normalized * 0.65
      context.beginPath()
      context.roundRect(x, y, barWidth, barHeight, barWidth / 2)
      context.fill()
    })
    context.globalAlpha = 1
  }, [bars, height, measurementRevision])

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className="h-8 w-full text-foreground/85"
      aria-hidden
      data-testid="voice-wave-canvas"
    />
  )
}

function VoiceRecorderPanel({
  bars,
  durationMs,
  loading,
}: {
  bars: readonly number[]
  durationMs: number
  loading: boolean
}) {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-8 min-w-0 flex-1 items-center justify-center overflow-hidden">
        {loading ? (
          <div className="oo-text-control flex min-w-0 items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span className="truncate">{t("chat.voiceStarting")}</span>
          </div>
        ) : (
          <VoiceWaveCanvas bars={bars} height={32} />
        )}
      </div>
      <span className="oo-text-control min-w-9 shrink-0 text-right font-normal text-muted-foreground tabular-nums">
        {voiceDurationLabel(durationMs)}
      </span>
    </div>
  )
}

export function ComposerTrailingControls({
  canSubmit,
  composerDisabled,
  contextUsage,
  turnState,
  modelCatalog,
  modelRequired = false,
  agentCatalog,
  agentEffortId,
  agentEffortSelectionEnabled,
  agentKind,
  agentMode,
  agentModelId,
  agentModelSelectionEnabled,
  agentModesEnabled,
  agentPickerLocked,
  externalAgents,
  modelRoutingEnabled,
  permissionMode,
  permissionModes,
  reasoningLevel,
  voiceEnabled,
  voiceActive,
  voiceBars,
  voiceDurationMs,
  voiceError,
  voiceRecorderError,
  voiceRetryBlob,
  voiceStarting,
  voiceTranscribing,
  willQueueMessage,
  onAddModel,
  onAgentPickerOpen,
  onCancelVoice,
  onDeleteModel,
  onRetryVoice,
  onSelectAgentEffort,
  onSelectAgentKind,
  onSelectAgentMode,
  onSelectAgentModel,
  onSelectPermissionMode,
  onRequestFullAccessPermissionMode,
  onSelectModel,
  onSelectReasoningLevel,
  onStartVoice,
  onStop,
  onStopVoice,
}: ComposerTrailingControlsProps) {
  const t = useT()
  const visibleVoiceError = voiceEnabled ? (voiceError ?? voiceRecorderError) : undefined
  const voiceMode = composerVoiceControlMode({ voiceActive, voiceStarting, voiceTranscribing, visibleVoiceError })
  const submit = composerSubmitState({ canSubmit, turnState, willQueueMessage })
  const retryDisabled = !voiceRetryBlob || voiceTranscribing
  const stopLabel = labelWithShortcut(t("aria.stop"), appCommandShortcutLabel(APP_COMMANDS.stopGeneration))

  return (
    <>
      {voiceActive ? (
        <VoiceRecorderPanel bars={voiceBars} durationMs={voiceDurationMs} loading={voiceMode === "starting"} />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 items-center justify-end gap-1 overflow-hidden",
          voiceActive ? "shrink-0" : "flex-1",
        )}
      >
        {voiceActive ? (
          <>
            {voiceMode === "recording-error" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={visibleVoiceError ?? undefined}
                aria-label={t("chat.voiceRetry")}
                className="size-8 rounded-full"
                disabled={retryDisabled}
                onClick={onRetryVoice}
              >
                <RotateCcw className="size-4" />
              </Button>
            ) : voiceMode === "starting" || voiceMode === "transcribing" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("chat.voiceCancel")}
                className="size-8 rounded-full bg-foreground/8 text-muted-foreground hover:bg-foreground/12 hover:text-foreground"
                onClick={onCancelVoice}
              >
                <Loader2 className="size-[18px] animate-spin" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("chat.voiceStop")}
                className="size-8 rounded-full bg-foreground/8 text-muted-foreground hover:bg-foreground/12 hover:text-foreground"
                onClick={onStopVoice}
              >
                <Square className="size-3.5" fill="currentColor" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("chat.voiceDiscard")}
              className="size-8 rounded-full bg-foreground text-background hover:bg-foreground/85 hover:text-background"
              onClick={onCancelVoice}
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            {voiceMode === "idle-error" ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={visibleVoiceError ?? undefined}
                  aria-label={t("chat.voiceRetry")}
                  className="size-8 rounded-full"
                  disabled={retryDisabled}
                  onClick={onRetryVoice}
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("chat.voiceCancel")}
                  className="size-8 rounded-full"
                  onClick={onCancelVoice}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : null}
            <ComposerModeControls
              agentCatalog={agentCatalog}
              agentEffortId={agentEffortId}
              agentEffortSelectionEnabled={agentEffortSelectionEnabled}
              agentKind={agentKind}
              agentMode={agentMode}
              agentModelId={agentModelId}
              agentModelSelectionEnabled={agentModelSelectionEnabled}
              agentModesEnabled={agentModesEnabled}
              agentPickerLocked={agentPickerLocked}
              composerDisabled={composerDisabled}
              contextUsage={contextUsage}
              externalAgents={externalAgents}
              modelCatalog={modelCatalog}
              modelRequired={modelRequired}
              modelRoutingEnabled={modelRoutingEnabled}
              permissionMode={permissionMode}
              permissionModes={permissionModes}
              reasoningLevel={reasoningLevel}
              voiceEnabled={voiceEnabled}
              onAddModel={onAddModel}
              onAgentPickerOpen={onAgentPickerOpen}
              onDeleteModel={onDeleteModel}
              onRequestFullAccessPermissionMode={onRequestFullAccessPermissionMode}
              onSelectAgentEffort={onSelectAgentEffort}
              onSelectAgentKind={onSelectAgentKind}
              onSelectAgentMode={onSelectAgentMode}
              onSelectAgentModel={onSelectAgentModel}
              onSelectPermissionMode={onSelectPermissionMode}
              onSelectModel={onSelectModel}
              onSelectReasoningLevel={onSelectReasoningLevel}
              onStartVoice={onStartVoice}
            />
            <PromptInputSubmit
              size="icon-sm"
              className="size-7"
              status={submit.visualStatus}
              disabled={submit.disabled}
              aria-label={
                submit.aria === "sending"
                  ? t("aria.sending")
                  : submit.aria === "stop"
                    ? t("aria.stop")
                    : submit.aria === "queue"
                      ? t("chat.queueSend")
                      : t("aria.send")
              }
              aria-keyshortcuts={
                submit.stopsGeneration ? appCommandAriaShortcut(APP_COMMANDS.stopGeneration) : undefined
              }
              title={submit.stopsGeneration ? stopLabel : submit.queuesMessage ? t("chat.queueSend") : undefined}
              onClick={
                submit.stopsGeneration
                  ? (event) => {
                      event.preventDefault()
                      void (async () => {
                        try {
                          await onStop()
                        } catch (cause) {
                          reportRendererHandledError("chat", "stopGeneration invoke failed", cause)
                          toast.error(t("chat.stopFailed"))
                        }
                      })()
                    }
                  : undefined
              }
            >
              {submit.queuesMessage ? <ListPlus className="size-4" /> : undefined}
            </PromptInputSubmit>
          </>
        )}
      </div>
    </>
  )
}
