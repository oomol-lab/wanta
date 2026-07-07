import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"
import type { ChatStatus } from "ai"

import { Loader2, Mic, RotateCcw, Square, X } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { composerSubmitState, composerVoiceControlMode } from "./composer-controls.ts"
import { formatTokenCount } from "./context-usage.ts"
import { AgentModePicker, ModelReasoningPicker } from "./ModelControls.tsx"
import { PermissionModePicker } from "./PermissionModePicker.tsx"
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { appCommandAriaShortcut, appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { cn } from "@/lib/utils"

interface ComposerTrailingControlsProps {
  canSubmit: boolean
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  initialSendPending: boolean
  isGenerating: boolean
  modelCatalog: ModelCatalog | null
  agentMode: AgentMode
  permissionMode: AgentPermissionMode
  reasoningLevel: ReasoningLevel
  status: ChatStatus
  voiceActive: boolean
  voiceBars: readonly number[]
  voiceDurationMs: number
  voiceError: string | null
  voiceRecorderError?: string
  voiceRetryBlob: Blob | null
  voiceStarting: boolean
  voiceTranscribing: boolean
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

function contextUsageTitle(usage: ContextUsageInfo, t: ReturnType<typeof useT>): string {
  const used = formatTokenCount(usage.usedTokens)
  if (usage.limitTokens !== undefined) {
    if (usage.limitKind === "compaction") {
      return t("chat.contextUsageCompaction", {
        limit: formatTokenCount(usage.limitTokens),
        percent: String(usage.percent ?? 0),
        used,
      })
    }
    return t("chat.contextUsage", {
      limit: formatTokenCount(usage.limitTokens),
      percent: String(usage.percent ?? 0),
      used,
    })
  }
  return t("chat.contextUsageUnknownLimit", { used })
}

function contextUsageTone(percent: number | undefined): string {
  if (percent === undefined) {
    return "text-muted-foreground"
  }
  if (percent >= 85) {
    return "text-destructive"
  }
  if (percent >= 70) {
    return "text-[var(--oo-warning-foreground)]"
  }
  return "text-muted-foreground"
}

function contextPanelTokenCount(value: number): string {
  return formatTokenCount(value).toLowerCase()
}

function contextUsagePanelTokens(usage: ContextUsageInfo, t: ReturnType<typeof useT>): string {
  const used = contextPanelTokenCount(usage.usedTokens)
  if (usage.limitTokens !== undefined) {
    if (usage.limitKind === "compaction") {
      return t("chat.contextUsagePanelTokensWithThreshold", {
        limit: contextPanelTokenCount(usage.limitTokens),
        used,
      })
    }
    return t("chat.contextUsagePanelTokens", { limit: contextPanelTokenCount(usage.limitTokens), used })
  }
  return t("chat.contextUsagePanelTokensUnknown", { used })
}

function contextUsagePanelPercent(usage: ContextUsageInfo, t: ReturnType<typeof useT>): string | null {
  if (usage.percent === undefined) {
    return null
  }
  if (usage.limitKind === "compaction") {
    if (usage.compactionThresholdTokens !== undefined && usage.usedTokens >= usage.compactionThresholdTokens) {
      return t("chat.contextUsagePanelOverThreshold")
    }
    return t("chat.contextUsagePanelThresholdPercent", {
      percent: String(usage.percent),
    })
  }
  const remaining = Math.max(0, 100 - usage.percent)
  return t("chat.contextUsagePanelPercent", {
    percent: String(usage.percent),
    remaining: String(remaining),
  })
}

function contextUsagePanelWindow(usage: ContextUsageInfo, t: ReturnType<typeof useT>): string | null {
  if (usage.inputLimitTokens) {
    return t("chat.contextUsagePanelInputLimit", { limit: contextPanelTokenCount(usage.inputLimitTokens) })
  }
  if (usage.contextWindowTokens) {
    return t("chat.contextUsagePanelWindow", { limit: contextPanelTokenCount(usage.contextWindowTokens) })
  }
  return null
}

function contextPanelPlacement(rect: DOMRect): React.CSSProperties {
  const margin = 12
  const width = 228
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, margin), window.innerWidth - width - margin)
  const bottom = Math.max(margin, window.innerHeight - rect.top + 8)
  return { left, bottom, width }
}

function ContextUsageIndicator({ usage }: { usage: ContextUsageInfo | null }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({})
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const panelId = React.useId()

  const updatePanelPlacement = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) {
      return
    }
    setPanelStyle(contextPanelPlacement(trigger.getBoundingClientRect()))
  }, [])

  React.useLayoutEffect(() => {
    if (open) {
      updatePanelPlacement()
    }
  }, [open, updatePanelPlacement])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false)
        window.requestAnimationFrame(() => triggerRef.current?.focus())
      }
    }
    const handleReposition = (): void => updatePanelPlacement()
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleReposition)
    window.addEventListener("scroll", handleReposition, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleReposition)
      window.removeEventListener("scroll", handleReposition, true)
    }
  }, [open, updatePanelPlacement])

  if (!usage) {
    return null
  }
  const title = contextUsageTitle(usage, t)
  const panelPercent = contextUsagePanelPercent(usage, t)
  const panelWindow = contextUsagePanelWindow(usage, t)
  const progress = Math.min(100, Math.max(0, usage.percent ?? 0))
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress / 100)
  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          id={panelId}
          style={panelStyle}
          className="fixed z-50 rounded-xl border bg-popover/95 px-4 py-3 text-center text-popover-foreground shadow-xl backdrop-blur"
        >
          <div className="oo-text-caption-compact font-medium text-muted-foreground">
            {t("chat.contextUsagePanelTitle")}
          </div>
          {panelPercent ? <div className="oo-text-control mt-1 font-semibold">{panelPercent}</div> : null}
          <div className="oo-text-control mt-1 leading-snug font-semibold">{contextUsagePanelTokens(usage, t)}</div>
          {panelWindow ? (
            <div className="oo-text-caption-compact mt-1 leading-snug text-muted-foreground">{panelWindow}</div>
          ) : null}
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={title}
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={title}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full outline-none",
          "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
          contextUsageTone(usage.percent),
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden="true">
          <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
          />
        </svg>
      </button>
      {panel}
    </>
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
  initialSendPending,
  isGenerating,
  modelCatalog,
  agentMode,
  permissionMode,
  reasoningLevel,
  status,
  voiceActive,
  voiceBars,
  voiceDurationMs,
  voiceError,
  voiceRecorderError,
  voiceRetryBlob,
  voiceStarting,
  voiceTranscribing,
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
  const submit = composerSubmitState({ canSubmit, initialSendPending, isGenerating, status })
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
            <ContextUsageIndicator usage={contextUsage} />
            <AgentModePicker disabled={composerDisabled} value={agentMode} onValueChange={onSelectAgentMode} />
            <PermissionModePicker
              disabled={composerDisabled}
              value={permissionMode}
              onDefault={onSelectDefaultPermissionMode}
              onFullAccess={onRequestFullAccessPermissionMode}
            />
            <ModelReasoningPicker
              catalog={modelCatalog}
              disabled={composerDisabled}
              reasoningLevel={reasoningLevel}
              onAddModel={onAddModel}
              onDeleteModel={onDeleteModel}
              onSelectModel={onSelectModel}
              onSelectReasoningLevel={onSelectReasoningLevel}
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
              size="icon-sm"
              className="size-7"
              status={submit.visualStatus}
              disabled={submit.disabled}
              aria-label={
                submit.aria === "sending" ? t("aria.sending") : submit.aria === "stop" ? t("aria.stop") : t("aria.send")
              }
              aria-keyshortcuts={
                submit.stopsGeneration ? appCommandAriaShortcut(APP_COMMANDS.stopGeneration) : undefined
              }
              title={submit.stopsGeneration ? stopLabel : undefined}
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
