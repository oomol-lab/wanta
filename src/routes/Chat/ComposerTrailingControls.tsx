import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ChatStatus } from "ai"

import { Loader2, Mic, RotateCcw, Square, X } from "lucide-react"
import * as React from "react"
import { composerSubmitState, composerVoiceControlMode } from "./composer-controls.ts"
import { ModelPicker } from "./ModelControls.tsx"
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

interface ComposerTrailingControlsProps {
  canSubmit: boolean
  composerDisabled: boolean
  initialSendPending: boolean
  isGenerating: boolean
  isSubmitted: boolean
  modelCatalog: ModelCatalog | null
  status: ChatStatus
  voiceActive: boolean
  voiceBars: readonly number[]
  voiceDurationMs: number
  voiceError: string | null
  voiceRecorderError?: string
  voiceRetryBlob: Blob | null
  voiceTranscribing: boolean
  onAddModel: () => void
  onCancelVoice: () => void
  onDeleteModel: (id: string) => void
  onRetryVoice: () => void
  onSelectModel: (choice: ModelChoice) => void
  onStartVoice: () => void
  onStop: () => void
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

function VoiceRecorderPanel({ bars, durationMs }: { bars: readonly number[]; durationMs: number }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-8 min-w-0 flex-1 items-center justify-center overflow-hidden">
        <VoiceWaveCanvas bars={bars} height={32} />
      </div>
      <span className="min-w-9 shrink-0 text-right text-sm leading-none font-normal text-muted-foreground tabular-nums">
        {voiceDurationLabel(durationMs)}
      </span>
    </div>
  )
}

export function ComposerTrailingControls({
  canSubmit,
  composerDisabled,
  initialSendPending,
  isGenerating,
  isSubmitted,
  modelCatalog,
  status,
  voiceActive,
  voiceBars,
  voiceDurationMs,
  voiceError,
  voiceRecorderError,
  voiceRetryBlob,
  voiceTranscribing,
  onAddModel,
  onCancelVoice,
  onDeleteModel,
  onRetryVoice,
  onSelectModel,
  onStartVoice,
  onStop,
  onStopVoice,
}: ComposerTrailingControlsProps) {
  const t = useT()
  const visibleVoiceError = voiceError ?? voiceRecorderError
  const voiceMode = composerVoiceControlMode({ voiceActive, voiceTranscribing, visibleVoiceError })
  const submit = composerSubmitState({ canSubmit, initialSendPending, isGenerating, isSubmitted, status })
  const retryDisabled = !voiceRetryBlob || voiceTranscribing

  return (
    <>
      {voiceActive ? <VoiceRecorderPanel bars={voiceBars} durationMs={voiceDurationMs} /> : null}
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
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
            ) : voiceMode === "transcribing" ? (
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
            <ModelPicker
              catalog={modelCatalog}
              disabled={composerDisabled}
              onSelect={onSelectModel}
              onDelete={onDeleteModel}
              onAdd={onAddModel}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("chat.voiceInput")}
              aria-label={t("chat.voiceInput")}
              disabled={composerDisabled}
              className="size-8 rounded-full"
              onClick={onStartVoice}
            >
              <Mic className="size-4" />
            </Button>
            <PromptInputSubmit
              size="icon-xs"
              className="!size-7"
              status={submit.visualStatus}
              disabled={submit.disabled}
              aria-label={
                submit.aria === "sending" ? t("aria.sending") : submit.aria === "stop" ? t("aria.stop") : t("aria.send")
              }
              onClick={
                submit.stopsGeneration
                  ? (event) => {
                      event.preventDefault()
                      onStop()
                    }
                  : undefined
              }
            />
          </>
        )}
      </div>
    </>
  )
}
