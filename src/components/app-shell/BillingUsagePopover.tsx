import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"

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
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useBillableSeats } from "@/hooks/useBillableSeats"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { billingRequestScopeForWorkspace } from "@/lib/billing-scope"
import { cn } from "@/lib/utils"
import { teamPlanLabel } from "@/routes/Billing/team-plan-label"
import { buildTeamSubscriptionOverview } from "@/routes/Billing/team-subscription-model"
import { buildCategorySummaries, formatCredit, getSummary, statsTotalCredit, toNumber } from "@/routes/Billing/usage.ts"

const usagePeriodDays = 30
const cacheFreshMs = 60_000
export type BillingDetailsTarget = "credits" | "plans"

interface BillingUsagePopoverProps {
  cacheScope: string
  sharedConnectorCount?: number
  workspace: WorkspaceSelection
  onViewDetails: (target?: BillingDetailsTarget) => void
}

export function BillingUsagePopover({
  cacheScope,
  sharedConnectorCount,
  workspace,
  onViewDetails,
}: BillingUsagePopoverProps) {
  const t = useT()
  const { login } = useAuth()
  const [open, setOpen] = React.useState(false)
  const seatState = useBillableSeats(workspace, open)
  const billingRequestScope = React.useMemo(() => billingRequestScopeForWorkspace(workspace), [workspace])
  const canManageFunding = billingRequestScope?.canManageFunding === true
  const canManageTeamSubscription = billingRequestScope?.canManageTeamSubscription === true
  const { data, error, loading, refresh } = useBillingOverview(usagePeriodDays, {
    cacheScope,
    enabled: open,
    requestScope: billingRequestScope,
    staleMs: cacheFreshMs,
  })
  // 会话过期后全局登录态会失效：重新登录刷新会话，而非误导用户去充值。
  const isSessionExpired = error?.kind === "auth_required"
  const handleSignIn = React.useCallback(() => {
    void login().then(() => refresh({ force: true }))
  }, [login, refresh])
  const openDetails = React.useCallback(
    (target?: BillingDetailsTarget): void => {
      setOpen(false)
      onViewDetails(target)
    },
    [onViewDetails],
  )

  const summaries = React.useMemo(
    () => buildCategorySummaries(data?.spend, data?.metering),
    [data?.spend, data?.metering],
  )
  const categorySpendTotal = summaries.reduce((sum, item) => sum + item.credit, 0)
  const totalSpend = categorySpendTotal > 0 ? categorySpendTotal : statsTotalCredit(data?.spend)
  const balanceAvailable = data?.balanceAvailable === true
  const spendAvailable = data?.spendAvailable === true
  const hasNoUsage = spendAvailable && totalSpend === 0
  const currentCredit = toNumber(data?.balance?.total.currentCredit)
  const averageDailySpend = totalSpend / usagePeriodDays
  const coverageDays = averageDailySpend > 0 ? Math.floor(currentCredit / averageDailySpend) : 0
  const showCoverageDays = totalSpend >= 0.01 && coverageDays > 0 && coverageDays <= 999
  const modelSpend = getSummary(summaries, "model").credit
  const apiSpend = getSummary(summaries, "api").credit
  const connectorSpend = getSummary(summaries, "link").credit
  // The compact plan card exposes plan and seat management actions, so it belongs to the team creator only.
  const showTeamPlanSection = canManageTeamSubscription
  const seatCountAvailable = seatState.count !== null && !seatState.error
  const teamDetailsAvailable = data?.subscriptionAvailable === true && data.teamPendingPaymentAvailable === true
  const teamOverview = React.useMemo(
    () =>
      buildTeamSubscriptionOverview({
        canManage: canManageTeamSubscription,
        memberCount: seatState.count,
        pendingPayment: data?.teamPendingPayment ?? null,
        sharedConnectorCount,
        subscription: data?.subscription ?? null,
      }),
    [canManageTeamSubscription, data?.subscription, data?.teamPendingPayment, seatState.count, sharedConnectorCount],
  )
  const showUpgradePrompt = Boolean(
    showTeamPlanSection &&
    teamDetailsAvailable &&
    data &&
    !error &&
    seatCountAvailable &&
    teamOverview.recommendedAction === "upgrade_plan",
  )
  const showSeatPrompt = Boolean(
    showTeamPlanSection &&
    teamDetailsAvailable &&
    data &&
    !error &&
    seatCountAvailable &&
    teamOverview.recommendedAction === "add_seats",
  )
  // 仅在真正拿到余额（无错误）且为 0 时才提示耗尽；会话过期/读取失败一律不显示破坏性"余额耗尽"。
  const hasNoCredits = Boolean(canManageFunding && balanceAvailable && data?.balance && currentCredit <= 0 && !error)
  const planActionLabel = !teamDetailsAvailable
    ? null
    : teamOverview.hasPendingPayment
      ? t("billing.teamContinuePayment")
      : showSeatPrompt
        ? t("billing.popover.manageSeats")
        : teamOverview.currentPlan === null
          ? t("billing.popover.upgradeTeamPlanAction")
          : teamOverview.currentPlan === "team_plus"
            ? t("billing.popover.upgradePlanAction")
            : null
  const planStatusVariant: React.ComponentProps<typeof Badge>["variant"] = !teamDetailsAvailable
    ? "outline"
    : teamOverview.hasPendingPayment || showSeatPrompt
      ? "warning"
      : teamOverview.currentPlan === null || showUpgradePrompt
        ? "muted"
        : "success"

  const planCardContent = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="oo-text-label flex items-center gap-2 text-foreground">
            <ShieldCheckIcon className="size-4 text-muted-foreground" />
            <span>
              {!teamDetailsAvailable
                ? t("billing.planStatus.title")
                : teamOverview.currentPlan
                  ? teamPlanLabel(teamOverview.currentPlan, t)
                  : t("billing.popover.teamPlanTitle")}
            </span>
          </div>
          <div className="oo-text-caption-compact mt-1 text-muted-foreground">
            {teamDetailsAvailable && teamOverview.currentPlan === null ? `${t("billing.popover.currentTeam")} · ` : ""}
            {!teamDetailsAvailable
              ? t("billing.popover.planUnavailableMeta")
              : seatState.loading
                ? t("billing.popover.planSeatsLoading")
                : !seatCountAvailable || teamOverview.usedSeats === null
                  ? t("billing.popover.planSeatsUnavailable")
                  : teamOverview.seatCapacity === null
                    ? t("billing.popover.planMembers", { count: teamOverview.usedSeats })
                    : t("billing.popover.planSeats", {
                        count: teamOverview.usedSeats,
                        limit: teamOverview.seatCapacity,
                      })}
            {sharedConnectorCount === undefined
              ? ""
              : ` · ${t("billing.popover.sharedLinks", { count: sharedConnectorCount })}`}
          </div>
        </div>
        <Badge variant={planStatusVariant}>
          {!teamDetailsAvailable
            ? t("billing.popover.planUnavailableStatus")
            : teamOverview.hasPendingPayment
              ? t("billing.teamPaymentPending")
              : showSeatPrompt
                ? t("billing.popover.seatLimitHint")
                : showUpgradePrompt
                  ? t("billing.popover.upgradeHint")
                  : teamOverview.currentPlan === null
                    ? t("billing.popover.planInactive")
                    : t("billing.popover.planActive")}
        </Badge>
      </div>
      <p className="oo-text-caption mt-3 text-muted-foreground">
        {!teamDetailsAvailable
          ? t("billing.popover.planUnavailableDescription")
          : teamOverview.hasPendingPayment
            ? t("billing.popover.pendingPaymentRecommendation")
            : showSeatPrompt
              ? t("billing.popover.seatRecommendation")
              : teamOverview.currentPlan === null
                ? t("billing.popover.noPlanRecommendation")
                : showUpgradePrompt
                  ? t("billing.popover.proRecommendation")
                  : t("billing.popover.planDescription")}
      </p>
      {planActionLabel ? (
        <span className="oo-text-label mt-3 ml-auto flex w-fit items-center justify-center gap-1 text-foreground underline-offset-4 group-hover:underline">
          {planActionLabel}
          <ArrowRightIcon className="size-4" />
        </span>
      ) : null}
    </>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("billing.popover.tooltip")}
          aria-label={t("billing.popover.tooltip")}
          className={cn(
            "oo-toolbar-button relative flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
            open && "bg-accent text-foreground",
          )}
        >
          <GaugeIcon className="size-4" />
          {hasNoCredits ? (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive" aria-hidden="true" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={8}
        aria-label={t("billing.popover.title")}
        className="w-[min(23rem,calc(100vw-1rem))] overflow-hidden p-0 [-webkit-app-region:no-drag]"
      >
        <div className="max-h-(--radix-popover-content-available-height) overflow-y-auto">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="oo-text-title flex items-center gap-2 text-foreground">
              <WalletCardsIcon className="size-4" />
              <span>{t("billing.popover.title")}</span>
            </div>
            <PopoverClose asChild>
              <button
                type="button"
                aria-label={t("billing.popover.close")}
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </PopoverClose>
          </div>

          <div className="grid gap-4 px-4 pb-4">
            {error ? (
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
            ) : !data ? (
              <BillingUsageSkeleton />
            ) : (
              <>
                {showTeamPlanSection ? (
                  planActionLabel ? (
                    <button
                      type="button"
                      className="group rounded-lg border border-border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                      onClick={() => openDetails("plans")}
                    >
                      {planCardContent}
                    </button>
                  ) : (
                    <section className="rounded-lg border border-border p-3">{planCardContent}</section>
                  )
                ) : null}

                <section className="grid gap-3">
                  {canManageFunding ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="oo-text-label text-muted-foreground">{t("billing.availableCredits")}</div>
                        <Button type="button" size="sm" onClick={() => openDetails("credits")}>
                          {t("billing.topUpBalance")}
                        </Button>
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <div className="oo-text-metric-large text-foreground">
                            {balanceAvailable ? formatCredit(currentCredit) : "—"}
                          </div>
                        </div>
                        <div className="oo-text-body text-right text-muted-foreground">
                          {!spendAvailable
                            ? t("billing.usageUnavailable")
                            : hasNoUsage
                              ? t("billing.popover.noUsageTitle")
                              : showCoverageDays
                                ? t("billing.popover.coverageDays", { days: coverageDays })
                                : t("billing.coverageStable")}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <div className="oo-text-label text-muted-foreground">{t("billing.fundingAccount")}</div>
                        <div className="oo-text-title text-foreground">{t("billing.fundingManagedByCreator")}</div>
                        <p className="oo-text-caption text-muted-foreground">{t("billing.fundingMemberDescription")}</p>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-2 border-t border-border pt-3">
                    {spendAvailable && !hasNoUsage ? (
                      <div className="oo-text-caption-compact flex items-center justify-between gap-3 text-muted-foreground">
                        <span>{t("billing.popover.periodSpend", { amount: formatCredit(totalSpend) })}</span>
                        <span>{t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}</span>
                      </div>
                    ) : hasNoUsage ? (
                      <p className="oo-text-caption text-muted-foreground">{t("billing.popover.noUsageDescription")}</p>
                    ) : null}
                  </div>
                </section>

                {!hasNoUsage ? (
                  <section className="grid grid-cols-3 gap-2">
                    <UsageMiniMetric
                      label={t("billing.modelSpend")}
                      value={spendAvailable ? formatCredit(modelSpend) : "—"}
                    />
                    <UsageMiniMetric
                      label={t("billing.category.api")}
                      value={spendAvailable ? formatCredit(apiSpend) : "—"}
                    />
                    <UsageMiniMetric
                      label={t("billing.category.link")}
                      value={spendAvailable ? formatCredit(connectorSpend) : "—"}
                    />
                  </section>
                ) : null}
              </>
            )}
          </div>

          <button
            type="button"
            className="oo-text-label flex h-10 w-full items-center justify-center gap-2 border-t border-border bg-muted/20 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            onClick={() => openDetails()}
          >
            {t("billing.popover.viewDetails")}
            <ArrowRightIcon className="size-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function BillingUsageSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
      <div className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-28" />
          </div>
          <Skeleton className="mt-5 h-5 w-24" />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
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
