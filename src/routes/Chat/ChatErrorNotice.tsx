import type { ChatErrorKind, ChatErrorSeverity } from "./chat-error.ts"

import { AlertTriangle, CheckIcon, CopyIcon, ExternalLink, RefreshCw } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { resolveChatError } from "./chat-error.ts"
import { canAutoPromptPayment } from "./payment-auto-prompt.ts"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"
import { getCreditBalance } from "@/lib/billing-client"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

interface ChatErrorNoticeProps {
  autoOpenKey?: string
  billingCacheScope: string
  errorCode?: string
  errorKind?: ChatErrorKind
  message: string
  onViewBilling?: () => void
}

const paymentRecoveryPendingKey = "lumo-payment-recovery-pending"
const paymentRecoveryPendingTtlMs = 24 * 60 * 60 * 1000
const copyFeedbackMs = 1_500
const CreditPurchaseModal = React.lazy(() =>
  import("@/routes/Billing/CreditPurchaseModal").then((module) => ({ default: module.CreditPurchaseModal })),
)

function markPaymentRecoveryPending(): void {
  try {
    localStorage.setItem(
      paymentRecoveryPendingKey,
      JSON.stringify({ expiresAt: Date.now() + paymentRecoveryPendingTtlMs }),
    )
  } catch {
    // localStorage 不可用时只跳过跨刷新恢复；当前弹窗仍可手动刷新余额。
  }
}

function clearPaymentRecoveryPending(): void {
  try {
    localStorage.removeItem(paymentRecoveryPendingKey)
  } catch {
    // 忽略存储不可用。
  }
}

function hasPaymentRecoveryPending(): boolean {
  try {
    const raw = localStorage.getItem(paymentRecoveryPendingKey)
    if (!raw) {
      return false
    }
    const parsed = JSON.parse(raw) as { expiresAt?: unknown }
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0
    if (Date.now() <= expiresAt) {
      return true
    }
    localStorage.removeItem(paymentRecoveryPendingKey)
    return false
  } catch {
    return false
  }
}

function severityClassName(severity: ChatErrorSeverity): string {
  switch (severity) {
    case "warning":
      return "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)]"
    case "info":
      return "border-border bg-muted/55"
    case "destructive":
      return "border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)]"
  }
}

function iconClassName(severity: ChatErrorSeverity): string {
  switch (severity) {
    case "warning":
      return "bg-[var(--oo-warning-surface)] text-[var(--oo-warning-foreground)]"
    case "info":
      return "bg-muted text-muted-foreground"
    case "destructive":
      return "bg-destructive/10 text-destructive"
  }
}

export function ChatErrorNotice({
  autoOpenKey,
  billingCacheScope,
  errorCode,
  errorKind,
  message,
  onViewBilling,
}: ChatErrorNoticeProps) {
  const t = useT()
  const error = resolveChatError(message, { errorCode, errorKind })
  const [purchaseDialogOpen, setPurchaseDialogOpen] = React.useState(false)
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false)
  const [balanceLoading, setBalanceLoading] = React.useState(false)
  const [balanceChecked, setBalanceChecked] = React.useState(false)
  const [balance, setBalance] = React.useState<string | null>(null)
  const [hasCredits, setHasCredits] = React.useState<boolean | null>(null)
  const [recovered, setRecovered] = React.useState(false)
  const [refreshFailed, setRefreshFailed] = React.useState(false)
  const [diagnosticsCopied, setDiagnosticsCopied] = React.useState(false)
  const confirmAutoPromptedRef = React.useRef(false)
  const copyFeedbackTimerRef = React.useRef<number | undefined>(undefined)
  const isPaymentRequired = error.kind === "payment_required"

  const refreshBalance = React.useCallback(async (): Promise<boolean> => {
    setBalanceLoading(true)
    setRefreshFailed(false)
    try {
      const result = await getCreditBalance()
      setBalance(result.balance)
      setHasCredits(result.hasCredits)
      return result.hasCredits
    } catch {
      setBalance(null)
      setHasCredits(null)
      setRefreshFailed(true)
      return false
    } finally {
      setBalanceChecked(true)
      setBalanceLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setBalance(null)
    setBalanceChecked(false)
    setHasCredits(null)
    setRecovered(false)
    setRefreshFailed(false)
    setPurchaseDialogOpen(false)
    setConfirmDialogOpen(false)
  }, [autoOpenKey])

  React.useEffect(() => {
    if (!isPaymentRequired) {
      return
    }
    let cancelled = false
    void refreshBalance().then((hasCredits) => {
      if (cancelled) {
        return
      }
      if (hasCredits) {
        clearPaymentRecoveryPending()
        setRecovered(true)
        setPurchaseDialogOpen(false)
        setConfirmDialogOpen(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isPaymentRequired, refreshBalance])

  React.useEffect(() => {
    if (!canAutoPromptPayment({ autoOpenKey, balanceChecked, hasCredits, isPaymentRequired, recovered })) {
      return
    }
    const storageKey = `lumo-payment-dialog-opened:${autoOpenKey}`
    try {
      if (sessionStorage.getItem(storageKey)) {
        return
      }
      sessionStorage.setItem(storageKey, "1")
    } catch {
      // 忽略 sessionStorage 不可用；这种情况下仍自动打开一次。
    }
    if (hasPaymentRecoveryPending()) {
      return
    }
    setPurchaseDialogOpen(true)
  }, [autoOpenKey, balanceChecked, hasCredits, isPaymentRequired, recovered])

  React.useEffect(() => {
    confirmAutoPromptedRef.current = false
  }, [autoOpenKey])

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  React.useEffect(() => {
    setDiagnosticsCopied(false)
    if (copyFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = undefined
    }
  }, [error.diagnostics])

  React.useEffect(() => {
    if (
      !canAutoPromptPayment({ autoOpenKey, balanceChecked, hasCredits, isPaymentRequired, recovered }) ||
      confirmDialogOpen ||
      confirmAutoPromptedRef.current
    ) {
      return
    }
    if (hasPaymentRecoveryPending()) {
      confirmAutoPromptedRef.current = true
      setConfirmDialogOpen(true)
    }
  }, [balanceChecked, confirmDialogOpen, hasCredits, isPaymentRequired, recovered])

  const handleCopyDiagnostics = React.useCallback(() => {
    void writeClipboardText(error.diagnostics).then((didCopy) => {
      if (!didCopy) {
        setDiagnosticsCopied(false)
        toast.error(t("chatError.common.copyFailed"))
        return
      }
      setDiagnosticsCopied(true)
      if (copyFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setDiagnosticsCopied(false)
        copyFeedbackTimerRef.current = undefined
      }, copyFeedbackMs)
    })
  }, [error.diagnostics, t])

  const handleCheckoutOpened = React.useCallback(() => {
    markPaymentRecoveryPending()
    confirmAutoPromptedRef.current = true
    setConfirmDialogOpen(true)
  }, [])

  const handlePaymentCompleted = React.useCallback(async () => {
    const hasCredits = await refreshBalance()
    if (hasCredits) {
      clearPaymentRecoveryPending()
      setRecovered(true)
      setPurchaseDialogOpen(false)
      setConfirmDialogOpen(false)
      return
    }
    setRefreshFailed(true)
    setConfirmDialogOpen(false)
  }, [refreshBalance])

  const title = recovered ? t("chatError.paymentReturn.updatedTitle") : t(error.titleKey)
  const description = recovered
    ? t("chatError.paymentReturn.updatedDescription")
    : (error.descriptionText ?? t(error.descriptionKey))
  const effectiveSeverity: ChatErrorSeverity = recovered ? "info" : error.severity
  const diagnosticsActionKey = error.secondaryActionKey ?? "chatError.common.copyDiagnostics"

  return (
    <>
      <section
        className={cn(
          "not-prose max-w-full rounded-lg border px-3 py-3 text-card-foreground",
          severityClassName(effectiveSeverity),
        )}
        aria-live="polite"
      >
        <div className="flex gap-3">
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md",
              recovered
                ? "bg-[var(--oo-success-surface)] text-[var(--oo-success-foreground)]"
                : iconClassName(effectiveSeverity),
            )}
          >
            {recovered ? <CheckIcon className="size-4" /> : <AlertTriangle className="size-4" />}
          </span>
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid gap-1">
              <div className="text-sm leading-5 font-medium text-foreground">{title}</div>
              <div className="text-[13px] leading-5 text-muted-foreground">{description}</div>
              {recovered && balance ? (
                <div className="flex w-fit items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 text-xs font-medium text-foreground">
                  <span className="text-muted-foreground">{t("chatError.paymentDialog.currentCredits")}</span>
                  <span>{balance}</span>
                </div>
              ) : null}
            </div>
            {!recovered ? (
              <div className="flex flex-wrap items-center gap-2">
                {isPaymentRequired ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPurchaseDialogOpen(true)}>
                      {t(error.primaryActionKey ?? "chatError.paymentRequired.primaryAction")}
                    </Button>
                    {onViewBilling ? (
                      <Button type="button" variant="outline" size="sm" onClick={onViewBilling}>
                        <ExternalLink className="size-3.5" />
                        {t(error.secondaryActionKey ?? "chatError.paymentRequired.secondaryAction")}
                      </Button>
                    ) : null}
                  </>
                ) : error.diagnostics ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(diagnosticsCopied && "bg-background text-foreground")}
                    onClick={handleCopyDiagnostics}
                  >
                    {diagnosticsCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                    {diagnosticsCopied ? t("chat.copiedMessage") : t(diagnosticsActionKey)}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {isPaymentRequired ? (
        <>
          {purchaseDialogOpen ? (
            <React.Suspense fallback={null}>
              <CreditPurchaseModal
                cacheScope={billingCacheScope}
                open={purchaseDialogOpen}
                onClose={() => setPurchaseDialogOpen(false)}
                onCheckoutOpened={handleCheckoutOpened}
                onViewDetails={onViewBilling}
              />
            </React.Suspense>
          ) : null}
          <Dialog
            open={confirmDialogOpen}
            onClose={() => setConfirmDialogOpen(false)}
            closeLabel={t("common.cancel")}
            className="max-w-[400px]"
            title={t("chatError.paymentReturn.title")}
            description={t("chatError.paymentReturn.description")}
            footer={
              <>
                <Button type="button" variant="outline" onClick={() => setConfirmDialogOpen(false)}>
                  {t("chatError.paymentReturn.later")}
                </Button>
                <Button type="button" onClick={() => void handlePaymentCompleted()} disabled={balanceLoading}>
                  {balanceLoading ? <RefreshCw className="size-3.5 animate-spin" /> : null}
                  {t("chatError.paymentReturn.completed")}
                </Button>
              </>
            }
          >
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] leading-5 text-muted-foreground">
              {refreshFailed ? t("chatError.paymentReturn.refreshFailed") : t("chatError.paymentReturn.refreshHint")}
            </div>
          </Dialog>
        </>
      ) : null}
    </>
  )
}
