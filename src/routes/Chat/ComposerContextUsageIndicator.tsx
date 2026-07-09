import type { ContextUsageInfo } from "./context-usage.ts"

import * as React from "react"
import { createPortal } from "react-dom"
import { formatTokenCount } from "./context-usage.ts"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

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

export function ComposerContextUsageIndicator({ usage }: { usage: ContextUsageInfo | null }) {
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
