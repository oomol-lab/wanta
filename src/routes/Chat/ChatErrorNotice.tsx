import type { ChatErrorKind, ChatErrorSeverity } from "./chat-error.ts"

import { AlertTriangle, CheckIcon, CopyIcon, ExternalLink, RefreshCw } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { BillingRequestScopeContext } from "./billing-request-scope-context.ts"
import { resolveChatError } from "./chat-error.ts"
import { canAutoPromptPayment } from "./payment-auto-prompt.ts"
import {
  clearPaymentRecoveryPending,
  hasPaymentRecoveryPending,
  markPaymentRecoveryPending,
} from "./payment-recovery-storage.ts"
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

const copyFeedbackMs = 1_500
const CreditPurchaseModal = React.lazy(() =>
  import("@/routes/Billing/CreditPurchaseModal").then((module) => ({ default: module.CreditPurchaseModal })),
)

function autoPromptStorageKey(autoOpenKey: string): string {
  return `wanta-payment-dialog-opened:${autoOpenKey}`
}

function legacyAutoPromptStorageKey(autoOpenKey: string): string {
  return `lumo-payment-dialog-opened:${autoOpenKey}`
}

function markAutoPromptOpened(autoOpenKey: string): boolean {
  const key = autoPromptStorageKey(autoOpenKey)
  const legacyKey = legacyAutoPromptStorageKey(autoOpenKey)
  try {
    if (sessionStorage.getItem(key)) {
      return false
    }
    if (sessionStorage.getItem(legacyKey)) {
      sessionStorage.setItem(key, "1")
      sessionStorage.removeItem(legacyKey)
      return false
    }
    sessionStorage.setItem(key, "1")
    return true
  } catch {
    // 忽略 sessionStorage 不可用；这种情况下仍自动打开一次。
    return true
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
  const billingRequestScope = React.useContext(BillingRequestScopeContext)
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
  const balanceRequestIdRef = React.useRef(0)
  const isPaymentRequired = error.kind === "payment_required"
  const canManageFunding = billingRequestScope?.canManageFunding === true

  const refreshBalance = React.useCallback(async (): Promise<boolean | null> => {
    const requestId = ++balanceRequestIdRef.current
    if (!billingRequestScope || !canManageFunding) {
      setBalance(null)
      setBalanceChecked(Boolean(billingRequestScope))
      setBalanceLoading(false)
      setHasCredits(null)
      setRefreshFailed(false)
      return null
    }
    setBalanceLoading(true)
    setRefreshFailed(false)
    try {
      const result = await getCreditBalance(billingRequestScope)
      if (requestId !== balanceRequestIdRef.current) {
        return null
      }
      setBalance(result.balance)
      setHasCredits(result.hasCredits)
      return result.hasCredits
    } catch {
      if (requestId !== balanceRequestIdRef.current) {
        return null
      }
      setBalance(null)
      setHasCredits(null)
      setRefreshFailed(true)
      return false
    } finally {
      if (requestId === balanceRequestIdRef.current) {
        setBalanceChecked(true)
        setBalanceLoading(false)
      }
    }
  }, [billingRequestScope, canManageFunding])

  React.useEffect(() => {
    balanceRequestIdRef.current += 1
    setBalance(null)
    setBalanceChecked(false)
    setBalanceLoading(false)
    setHasCredits(null)
    setRecovered(false)
    setRefreshFailed(false)
    setPurchaseDialogOpen(false)
    setConfirmDialogOpen(false)
    confirmAutoPromptedRef.current = false
  }, [billingCacheScope, billingRequestScope])

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
    if (!isPaymentRequired || !canManageFunding) {
      return
    }
    let cancelled = false
    void refreshBalance().then((hasCredits) => {
      if (cancelled) {
        return
      }
      if (hasCredits) {
        clearPaymentRecoveryPending(billingCacheScope, billingRequestScope)
        setRecovered(true)
        setPurchaseDialogOpen(false)
        setConfirmDialogOpen(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [billingCacheScope, billingRequestScope, canManageFunding, isPaymentRequired, refreshBalance])

  React.useEffect(() => {
    const promptKey = autoOpenKey
    if (
      !promptKey ||
      !canAutoPromptPayment({
        autoOpenKey: promptKey,
        balanceChecked,
        canManageFunding,
        hasCredits,
        isPaymentRequired,
        recovered,
      })
    ) {
      return
    }
    if (!markAutoPromptOpened(promptKey)) {
      return
    }
    if (hasPaymentRecoveryPending(billingCacheScope, billingRequestScope)) {
      return
    }
    setPurchaseDialogOpen(true)
  }, [
    autoOpenKey,
    balanceChecked,
    billingCacheScope,
    billingRequestScope,
    canManageFunding,
    hasCredits,
    isPaymentRequired,
    recovered,
  ])

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
      !canAutoPromptPayment({
        autoOpenKey,
        balanceChecked,
        canManageFunding,
        hasCredits,
        isPaymentRequired,
        recovered,
      }) ||
      confirmDialogOpen ||
      confirmAutoPromptedRef.current
    ) {
      return
    }
    if (hasPaymentRecoveryPending(billingCacheScope, billingRequestScope)) {
      confirmAutoPromptedRef.current = true
      setConfirmDialogOpen(true)
    }
  }, [
    balanceChecked,
    billingCacheScope,
    billingRequestScope,
    canManageFunding,
    confirmDialogOpen,
    hasCredits,
    isPaymentRequired,
    recovered,
  ])

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
    markPaymentRecoveryPending(billingCacheScope, billingRequestScope)
    confirmAutoPromptedRef.current = true
    setConfirmDialogOpen(true)
  }, [billingCacheScope, billingRequestScope])

  const handlePaymentCompleted = React.useCallback(async () => {
    const hasCredits = await refreshBalance()
    if (hasCredits === null) {
      return
    }
    if (hasCredits) {
      clearPaymentRecoveryPending(billingCacheScope, billingRequestScope)
      setRecovered(true)
      setPurchaseDialogOpen(false)
      setConfirmDialogOpen(false)
      return
    }
    setRefreshFailed(true)
    setConfirmDialogOpen(false)
  }, [billingCacheScope, billingRequestScope, refreshBalance])

  const title = recovered ? t("chatError.paymentReturn.updatedTitle") : t(error.titleKey)
  const description = recovered
    ? t("chatError.paymentReturn.updatedDescription")
    : isPaymentRequired && !canManageFunding
      ? t("chatError.paymentRequired.creatorDescription")
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
              <div className="oo-text-label text-foreground">{title}</div>
              <div className="oo-text-control text-muted-foreground">{description}</div>
              {recovered && balance ? (
                <div className="oo-text-caption-compact flex w-fit items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 font-medium text-foreground">
                  <span className="text-muted-foreground">{t("chatError.paymentDialog.currentCredits")}</span>
                  <span>{balance}</span>
                </div>
              ) : null}
            </div>
            {!recovered ? (
              <div className="flex flex-wrap items-center gap-2">
                {isPaymentRequired ? (
                  <>
                    {canManageFunding ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setPurchaseDialogOpen(true)}>
                        {t(error.primaryActionKey ?? "chatError.paymentRequired.primaryAction")}
                      </Button>
                    ) : onViewBilling ? (
                      <Button type="button" variant="outline" size="sm" onClick={onViewBilling}>
                        {t("chatError.paymentRequired.creatorAction")}
                      </Button>
                    ) : null}
                    {canManageFunding && onViewBilling ? (
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
          {purchaseDialogOpen && canManageFunding ? (
            <React.Suspense fallback={null}>
              <CreditPurchaseModal
                cacheScope={billingCacheScope}
                open={purchaseDialogOpen}
                requestScope={billingRequestScope}
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
            <div className="oo-text-control rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
              {refreshFailed ? t("chatError.paymentReturn.refreshFailed") : t("chatError.paymentReturn.refreshHint")}
            </div>
          </Dialog>
        </>
      ) : null}
    </>
  )
}
