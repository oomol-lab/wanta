import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import {
  ArrowRightIcon,
  GaugeIcon,
  LogInIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { listOrganizationMembers } from "@/lib/organizations-client"
import { cn } from "@/lib/utils"
import { getCurrentWantaPlan, shouldRecommendPro, wantaPlanCapacity } from "@/routes/Billing/plans.ts"
import {
  buildCategorySummaries,
  formatCredit,
  getSummary,
  statsTotalCredit,
  statsTotalEvents,
  toNumber,
} from "@/routes/Billing/usage.ts"

const usagePeriodDays = 30
const cacheFreshMs = 60_000

interface BillingUsagePopoverProps {
  cacheScope: string
  sharedConnectorCount?: number
  workspace: WorkspaceSelection
  onViewDetails: () => void
}

export function BillingUsagePopover({
  cacheScope,
  sharedConnectorCount,
  workspace,
  onViewDetails,
}: BillingUsagePopoverProps) {
  const t = useT()
  const { login } = useAuth()
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const seatState = usePopoverBillableSeats(workspace, open)
  const { data, error, loading, refresh } = useBillingOverview(usagePeriodDays, {
    cacheScope,
    enabled: open,
    summaryOnly: true,
    staleMs: cacheFreshMs,
  })
  // 会话过期（计费用的 oomol-token 失效，agent 仍可用）：重新登录刷新会话，而非误导用户去充值。
  const isSessionExpired = error?.kind === "auth_required"
  const handleSignIn = React.useCallback(() => {
    void login().then(() => refresh({ force: true }))
  }, [login, refresh])
  const closeAndRestoreFocus = React.useCallback((): void => {
    setOpen(false)
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus()
    })
  }, [])

  const summaries = React.useMemo(
    () => buildCategorySummaries(data?.spend, data?.metering),
    [data?.spend, data?.metering],
  )
  const categorySpendTotal = summaries.reduce((sum, item) => sum + item.credit, 0)
  const totalSpend = categorySpendTotal > 0 ? categorySpendTotal : statsTotalCredit(data?.spend)
  const categoryEventTotal = summaries.reduce((sum, item) => sum + item.eventCount, 0)
  const totalEvents = categoryEventTotal > 0 ? categoryEventTotal : statsTotalEvents(data?.metering)
  const currentCredit = toNumber(data?.balance?.total.currentCredit)
  const originalCredit = toNumber(data?.balance?.total.originalCredit)
  const averageDailySpend = totalSpend / usagePeriodDays
  const coverageDays = averageDailySpend > 0 ? Math.floor(currentCredit / averageDailySpend) : 0
  const modelSpend = getSummary(summaries, "model").credit
  const connectorSpend = getSummary(summaries, "link").credit
  const currentWantaPlan = getCurrentWantaPlan(data?.subscription ?? null)
  const planCapacity = wantaPlanCapacity(currentWantaPlan)
  const billableSeats = workspace.type === "organization" ? Math.max(1, seatState.count ?? 1) : 1
  const recommendPro = shouldRecommendPro({
    currentPlan: currentWantaPlan,
    memberCount: billableSeats,
    totalEvents,
  })
  const showPlanPrompt = Boolean(data && !error && !currentWantaPlan)
  const showUpgradePrompt = Boolean(data && !error && currentWantaPlan && recommendPro)
  const availableShare =
    originalCredit > 0
      ? Math.max(0, Math.min(100, (currentCredit / originalCredit) * 100))
      : currentCredit > 0
        ? 100
        : 0
  // 仅在真正拿到余额（无错误）且为 0 时才提示耗尽；会话过期/读取失败一律不显示破坏性"余额耗尽"。
  const hasNoCredits = Boolean(data && currentCredit <= 0 && !error)

  React.useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return
      }
      closeAndRestoreFocus()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeAndRestoreFocus()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [closeAndRestoreFocus, open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        title={t("billing.popover.tooltip")}
        aria-label={t("billing.popover.tooltip")}
        aria-expanded={open}
        className={cn(
          "oo-toolbar-button relative flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
          open && "bg-accent text-foreground",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <GaugeIcon className="size-4" />
        {hasNoCredits ? (
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive" aria-hidden="true" />
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t("billing.popover.title")}
          className="absolute top-full right-0 z-50 mt-2 w-[23rem] overflow-hidden rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="oo-text-title flex items-center gap-2 text-foreground">
              <WalletCardsIcon className="size-4" />
              <span>{t("billing.popover.title")}</span>
            </div>
            <button
              type="button"
              aria-label={t("billing.popover.close")}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={closeAndRestoreFocus}
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="grid gap-4 px-4 pb-4">
            {loading && !data ? (
              <BillingUsageSkeleton />
            ) : error ? (
              <ErrorNotice
                error={error}
                compact
                showDiagnosticsCopy={false}
                action={
                  isSessionExpired
                    ? {
                        icon: <LogInIcon className="size-4" />,
                        label: t("billing.signInAgain"),
                        onClick: handleSignIn,
                      }
                    : {
                        icon: <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />,
                        label: t("billing.popover.retry"),
                        onClick: () => void refresh({ force: true }),
                      }
                }
              />
            ) : (
              <>
                <section className="grid gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="oo-text-label text-muted-foreground">{t("billing.availableCredits")}</div>
                      <div className="oo-text-metric-large mt-1 text-foreground">{formatCredit(currentCredit)}</div>
                    </div>
                    <div className="oo-text-body pt-5 text-right text-muted-foreground">
                      {averageDailySpend > 0
                        ? t("billing.popover.coverageDays", { days: coverageDays })
                        : t("billing.coverageStable")}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Progress value={availableShare} className="h-1.5 bg-muted" />
                    <div className="oo-text-caption-compact flex items-center justify-between gap-3 text-muted-foreground">
                      <span>{t("billing.popover.periodSpend", { amount: formatCredit(totalSpend) })}</span>
                      <span>{t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}</span>
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <UsageMiniMetric label={t("billing.modelSpend")} value={formatCredit(modelSpend)} />
                  <UsageMiniMetric label={t("billing.category.link")} value={formatCredit(connectorSpend)} />
                </section>

                <section className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="oo-text-label flex items-center gap-2 text-foreground">
                        <ShieldCheckIcon className="size-4 text-muted-foreground" />
                        <span>{currentWantaPlan ? wantaPlanLabel(currentWantaPlan, t) : t("billing.wantaNoPlan")}</span>
                      </div>
                      <div className="oo-text-caption-compact mt-1 text-muted-foreground">
                        {seatState.loading
                          ? t("billing.popover.planSeatsLoading")
                          : t("billing.popover.planSeats", { count: billableSeats, limit: planCapacity.members })}
                        {sharedConnectorCount === undefined
                          ? ""
                          : ` · ${t("billing.popover.sharedLinks", { count: sharedConnectorCount })}`}
                      </div>
                    </div>
                    <Badge variant={showUpgradePrompt || showPlanPrompt ? "default" : "outline"}>
                      {showUpgradePrompt
                        ? t("billing.popover.upgradeHint")
                        : showPlanPrompt
                          ? t("billing.popover.planInactive")
                          : t("billing.popover.planActive")}
                    </Badge>
                  </div>
                  <p className="oo-text-caption mt-3 text-muted-foreground">
                    {showPlanPrompt
                      ? t("billing.popover.noPlanRecommendation")
                      : showUpgradePrompt
                        ? t("billing.popover.proRecommendation")
                        : t("billing.popover.planDescription")}
                  </p>
                </section>
              </>
            )}
          </div>

          <div className="border-t border-border bg-muted/40 px-4 py-3">
            <Button
              type="button"
              className="w-full min-w-0"
              onClick={() => {
                closeAndRestoreFocus()
                onViewDetails()
              }}
            >
              {t(
                showPlanPrompt
                  ? "billing.planComparison.choosePlan"
                  : showUpgradePrompt
                    ? "billing.proRecommendation.cta"
                    : hasNoCredits
                      ? "billing.purchaseCredits"
                      : "billing.popover.viewDetails",
              )}
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function usePopoverBillableSeats(
  workspace: WorkspaceSelection,
  enabled: boolean,
): {
  count: number | null
  loading: boolean
} {
  const [count, setCount] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const organizationId = workspace.type === "organization" ? workspace.organizationId : null

  React.useEffect(() => {
    if (!enabled || !organizationId) {
      setCount(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void listOrganizationMembers(organizationId)
      .then((members) => {
        if (!cancelled) {
          setCount(Math.max(1, members.length))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCount(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [enabled, organizationId])

  return { count, loading }
}

function wantaPlanLabel(plan: "wanta_plus" | "wanta_pro", t: ReturnType<typeof useT>): string {
  return plan === "wanta_pro" ? t("billing.wantaProPlanTitle") : t("billing.wantaPlusPlanTitle")
}

function BillingUsageSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-2 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
      <Skeleton className="h-16 rounded-lg" />
    </div>
  )
}

function UsageMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border p-3">
      <div className="oo-text-caption-compact font-medium text-muted-foreground">{label}</div>
      <div className="oo-text-metric truncate text-foreground">{value}</div>
    </div>
  )
}
