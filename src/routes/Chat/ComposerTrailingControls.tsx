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
  agentMode: AgentMode
  permissionMode: AgentPermissionMode
  reasoningLevel: ReasoningLevel
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
  onCancelVoice: () => void
  onDeleteModel: (id: string) => void
  onRetryVoice: () => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectDefaultPermissionMode: () => void
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
  const [sizeRevision, setSizeRevision] = React.useState(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver(() => {
      setSizeRevision((revision) => revision + 1)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
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
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== canvasHeight) {
      canvas.height = canvasHeight
    }

    const context = canvas.getContext("2d")
    if (!context) {
      return
    }

    context.clearRect(0, 0, width, canvasHeight)
    context.fillStyle = getComputedStyle(canvas).color || "#18181b"

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
  }, [bars, height, sizeRevision])

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
  agentMode,
  permissionMode,
  reasoningLevel,
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
  onCancelVoice,
  onDeleteModel,
  onRetryVoice,
  onSelectAgentMode,
  onSelectDefaultPermissionMode,
  onRequestFullAccessPermissionMode,
  onSelectModel,
  onSelectReasoningLevel,
  onStartVoice,
  onStop,
  onStopVoice,
}: ComposerTrailingControlsProps) {
  const t = useT()
  const visibleVoiceError = voiceError ?? voiceRecorderError
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
              aria-label={t("chat.voiceCancel")}
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
              agentMode={agentMode}
              composerDisabled={composerDisabled}
              contextUsage={contextUsage}
              modelCatalog={modelCatalog}
              permissionMode={permissionMode}
              reasoningLevel={reasoningLevel}
              onAddModel={onAddModel}
              onDeleteModel={onDeleteModel}
              onRequestFullAccessPermissionMode={onRequestFullAccessPermissionMode}
              onSelectAgentMode={onSelectAgentMode}
              onSelectDefaultPermissionMode={onSelectDefaultPermissionMode}
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
