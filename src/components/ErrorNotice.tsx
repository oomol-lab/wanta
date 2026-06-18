import type { UserFacingError, UserFacingErrorSeverity } from "@/lib/user-facing-error"

import { AlertTriangleIcon, CheckIcon, CopyIcon, InfoIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

interface ErrorNoticeAction {
  icon?: React.ReactNode
  label: string
  onClick: () => void
}

interface ErrorNoticeProps {
  action?: ErrorNoticeAction
  className?: string
  compact?: boolean
  error: UserFacingError
  showDiagnosticsCopy?: boolean
}

const copyFeedbackMs = 1500

export function ErrorNotice({
  action,
  className,
  compact = false,
  error,
  showDiagnosticsCopy = true,
}: ErrorNoticeProps) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | undefined>(undefined)
  const hasDiagnostics = showDiagnosticsCopy && Boolean(error.diagnostics)

  React.useEffect(() => {
    setCopied(false)
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [error.diagnostics])

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const copyDiagnostics = React.useCallback(() => {
    if (!error.diagnostics) {
      return
    }
    void writeClipboardText(error.diagnostics).then((didCopy) => {
      if (!didCopy) {
        toast.error(t("error.copyFailed"))
        return
      }
      setCopied(true)
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        setCopied(false)
        timerRef.current = undefined
      }, copyFeedbackMs)
    })
  }, [error.diagnostics, t])

  const Icon = error.severity === "info" ? InfoIcon : AlertTriangleIcon

  return (
    <section
      className={cn(
        "not-prose max-w-full rounded-md border px-3 py-2.5 text-card-foreground",
        severityClassName(error.severity),
        className,
      )}
      aria-live="polite"
    >
      <div className="flex min-w-0 gap-2.5">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", iconClassName(error.severity))}>
          <Icon className="size-3.5" />
        </span>
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="grid gap-0.5">
            <div className={cn("font-medium text-foreground", compact ? "text-[13px] leading-5" : "text-sm leading-5")}>
              {t(error.titleKey)}
            </div>
            <div className={cn("text-muted-foreground", compact ? "text-xs leading-5" : "text-[13px] leading-5")}>
              {userFacingErrorDescription(error, t)}
            </div>
          </div>
          {action || hasDiagnostics ? (
            <div className="flex flex-wrap items-center gap-2">
              {action ? (
                <Button type="button" variant="outline" size="sm" onClick={action.onClick}>
                  {action.icon}
                  {action.label}
                </Button>
              ) : null}
              {hasDiagnostics ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(copied && "bg-background text-foreground")}
                  onClick={copyDiagnostics}
                >
                  {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  {copied ? t("error.copied") : t("error.copyDiagnostics")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function severityClassName(severity: UserFacingErrorSeverity): string {
  switch (severity) {
    case "info":
      return "border-border bg-muted/55"
    case "warning":
      return "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)]"
    case "destructive":
      return "border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)]"
  }
}

function iconClassName(severity: UserFacingErrorSeverity): string {
  switch (severity) {
    case "info":
      return "bg-muted text-muted-foreground"
    case "warning":
      return "bg-[var(--oo-warning-surface)] text-[var(--oo-warning-foreground)]"
    case "destructive":
      return "bg-destructive/10 text-destructive"
  }
}
