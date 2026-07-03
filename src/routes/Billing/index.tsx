import type {
  BillingLogItem,
  BillingPeriodDays,
  BillingSpendStats,
  CreditItem,
  WantaPendingPaymentResult,
  WantaSubscriptionPlan,
} from "../../../electron/chat/common.ts"
import type { CategorySummary, UsageCategory } from "./usage.ts"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import {
  CreditCardIcon,
  GaugeIcon,
  GiftIcon,
  ImageIcon,
  ListIcon,
  LogInIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  UsersIcon,
  PiggyBankIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import * as React from "react"
import { CreditPurchaseModal } from "./CreditPurchaseModal.tsx"
import {
  getCurrentWantaPlan,
  hasAnyWantaSubscription,
  shouldRecommendPro,
  wantaPlanCapacity,
  wantaPlanLimits,
} from "./plans.ts"
import {
  buildCategorySummaries,
  buildDailySpendBuckets,
  billingCredit,
  billingEventCount,
  categoryOrder,
  formatCredit,
  formatDate,
  formatDateTime,
  formatPercent,
  getSummary,
  normalizeTimestamp,
  statsTotalCredit,
  statsTotalEvents,
  toNumber,
  usageCategory,
} from "./usage.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { listOrganizationMembers } from "@/lib/organizations-client"
import { cn } from "@/lib/utils"

interface BillingRouteProps {
  cacheScope: string
  onBack: () => void
  sharedConnectorCount?: number
  workspace: WorkspaceSelection
}

const periods: BillingPeriodDays[] = [7, 30, 90]
type PurchaseMode = "subscription" | "usage"

interface RecentRecord {
  amount: number
  category: UsageCategory
  createdAt: number
  eventCount?: number
  id: string
  source: string
  subject: string
}

export function BillingRoute({ cacheScope, onBack, sharedConnectorCount, workspace }: BillingRouteProps) {
  const t = useT()
  const { login } = useAuth()
  const [period, setPeriod] = React.useState<BillingPeriodDays>(30)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)
  const [purchaseMode, setPurchaseMode] = React.useState<PurchaseMode>("subscription")
  const { data, error, loading, refresh } = useBillingOverview(period, { cacheScope })
  const seatState = useOrganizationBillableSeats(workspace)
  // 会话过期：引导重新登录刷新会话，并避免在错误下方继续显示误导性的 "$0" 余额标题。
  const isSessionExpired = error?.kind === "auth_required"
  const handleSignIn = React.useCallback(() => {
    void login().then(() => refresh({ force: true }))
  }, [login, refresh])

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
  const modelSpend = getSummary(summaries, "model").credit
  const currentWantaPlan = getCurrentWantaPlan(data?.subscription ?? null)
  const hasWantaSubscription = hasAnyWantaSubscription(data?.subscription ?? null)
  const billingContext = React.useMemo(
    () =>
      buildBillingWorkspaceContext(
        workspace,
        seatState.count,
        sharedConnectorCount,
        t("billing.personalWorkspace"),
        t("billing.organizationWorkspace"),
      ),
    [seatState.count, sharedConnectorCount, t, workspace],
  )
  const currentPlanCapacity = wantaPlanCapacity(currentWantaPlan)
  const averageDailySpend = period > 0 ? totalSpend / period : 0
  const coverageDays = averageDailySpend > 0 ? Math.floor(currentCredit / averageDailySpend) : 0
  const availableShare =
    originalCredit > 0
      ? Math.max(0, Math.min(100, (currentCredit / originalCredit) * 100))
      : currentCredit > 0
        ? 100
        : 0
  const dailyBuckets = React.useMemo(
    () => buildDailySpendBuckets(data?.spend?.items ?? [], period, totalSpend),
    [data?.spend, period, totalSpend],
  )
  const hasEstimatedTrend = dailyBuckets.some((bucket) => bucket.estimated)
  const maxDailySpend = Math.max(
    ...dailyBuckets.map((bucket) => bucket.credit),
    hasEstimatedTrend ? averageDailySpend * 2 : 0,
  )
  const recentRecords = React.useMemo(
    () => buildRecentRecords(data?.logs ?? [], data?.spend?.items ?? []),
    [data?.logs, data?.spend?.items],
  )
  const recommendPro = shouldRecommendPro({
    currentPlan: currentWantaPlan,
    memberCount: billingContext.memberCount,
    totalEvents,
  })
  const showProRecommendation = Boolean(data && !error && recommendPro)

  const openPurchase = React.useCallback((mode: PurchaseMode) => {
    setPurchaseMode(mode)
    setPurchaseOpen(true)
  }, [])

  return (
    <>
      <PageRouteShell backLabel={t("billing.backToChat")} contentClassName="max-w-[84rem] gap-5" onBack={onBack}>
        <h1 className="oo-text-page-title">{t("billing.title")}</h1>

        <section className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--oo-divider)] pb-5">
          <div className="min-w-0">
            <p className="oo-text-body text-muted-foreground">{t("billing.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PeriodToggle period={period} onChange={setPeriod} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void refresh({ force: true })}
            >
              <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
              {t("billing.refresh")}
            </Button>
            <Button type="button" size="sm" onClick={() => openPurchase("subscription")}>
              <CreditCardIcon className="size-4" />
              {t("billing.purchaseCredits")}
            </Button>
          </div>
        </section>

        {error ? (
          <ErrorNotice
            error={error}
            action={
              isSessionExpired
                ? { icon: <LogInIcon className="size-4" />, label: t("billing.signInAgain"), onClick: handleSignIn }
                : undefined
            }
          />
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <WantaSubscriptionOverview
            canManage={billingContext.canManage}
            connectedProviderCount={billingContext.connectedProviderCount}
            currentPlan={currentWantaPlan}
            hasSubscription={hasWantaSubscription}
            loading={(loading && !data) || Boolean(error && !data)}
            memberCount={billingContext.memberCount}
            memberLoading={seatState.loading}
            pendingPayment={data?.wantaPendingPayment ?? null}
            planCapacity={currentPlanCapacity}
            workspaceLabel={billingContext.workspaceLabel}
            onManage={() => openPurchase("subscription")}
          />

          <BalanceOverview
            averageDailySpend={averageDailySpend}
            modelSpend={modelSpend}
            coverageDays={coverageDays}
            currentCredit={currentCredit}
            loading={(loading && !data) || isSessionExpired}
            totalEvents={totalEvents}
            totalSpend={totalSpend}
            availableShare={availableShare}
            onTopUp={() => openPurchase("usage")}
          />
        </section>

        {showProRecommendation ? (
          <ProUpgradeRecommendation
            currentPlan={currentWantaPlan}
            memberCount={billingContext.memberCount}
            totalEvents={totalEvents}
            onUpgrade={() => openPurchase("subscription")}
          />
        ) : null}

        <PlanComparison currentPlan={currentWantaPlan} onChoosePlan={() => openPurchase("subscription")} />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)]">
          <BillingPanel title={t("billing.categoryTitle")} meta={t("billing.categoryMeta")} bodyClassName="p-0">
            {loading && !data ? (
              <LoadingRows count={3} />
            ) : (
              <CategorySpendList summaries={summaries} total={totalSpend} />
            )}
          </BillingPanel>
          <BillingPanel title={t("billing.balanceLotsTitle")} meta={t("billing.balanceLotsMeta")} bodyClassName="p-0">
            {loading && !data ? <LoadingRows count={3} /> : <BalanceLots lots={data?.balance?.items ?? []} />}
          </BillingPanel>
        </section>

        <BillingPanel
          title={t("billing.trendTitle")}
          meta={t(hasEstimatedTrend ? "billing.trendEstimatedMeta" : "billing.trendMeta", { days: period })}
          bodyClassName="p-0"
        >
          {loading && !data ? (
            <Skeleton className="m-3 h-36 rounded-md" />
          ) : (
            <TrendChart buckets={dailyBuckets} maxDailySpend={maxDailySpend} />
          )}
        </BillingPanel>

        <BillingPanel
          title={t("billing.recordsTitle")}
          meta={t("billing.recordsMeta", { days: period })}
          bodyClassName="p-0"
        >
          {loading && !data ? <LoadingRows count={5} /> : <RecentRecords records={recentRecords} />}
        </BillingPanel>
      </PageRouteShell>
      <CreditPurchaseModal
        billingContext={billingContext}
        cacheScope={cacheScope}
        mode={purchaseMode}
        open={purchaseOpen}
        showViewDetails={false}
        onClose={() => {
          setPurchaseOpen(false)
          void refresh({ force: true })
        }}
      />
    </>
  )
}

interface BillingWorkspaceContext {
  canManage: boolean
  connectedProviderCount?: number
  memberCount: number
  organizationId?: string
  organizationName?: string
  workspaceLabel: string
}

function buildBillingWorkspaceContext(
  workspace: WorkspaceSelection,
  memberCount: number | null,
  connectedProviderCount?: number,
  personalWorkspaceLabel = "Personal workspace",
  organizationWorkspaceLabel = "Organization",
): BillingWorkspaceContext {
  if (workspace.type === "organization") {
    const organizationName = workspace.organization?.name ?? ""
    return {
      canManage: workspace.canManage,
      connectedProviderCount,
      memberCount: Math.max(1, memberCount ?? 1),
      organizationId: workspace.organizationId,
      organizationName,
      workspaceLabel: organizationName || organizationWorkspaceLabel,
    }
  }
  return {
    canManage: true,
    memberCount: 1,
    workspaceLabel: personalWorkspaceLabel,
  }
}

function useOrganizationBillableSeats(workspace: WorkspaceSelection): {
  count: number | null
  error: string | null
  loading: boolean
} {
  const [count, setCount] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const organizationId = workspace.type === "organization" ? workspace.organizationId : null

  React.useEffect(() => {
    if (!organizationId) {
      setCount(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    void listOrganizationMembers(organizationId)
      .then((members) => {
        if (!cancelled) {
          setCount(Math.max(1, members.length))
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setCount(null)
          setError(cause instanceof Error ? cause.message : String(cause))
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
  }, [organizationId])

  return { count, error, loading }
}

function WantaSubscriptionOverview({
  canManage,
  connectedProviderCount,
  currentPlan,
  hasSubscription,
  loading = false,
  memberCount,
  memberLoading,
  pendingPayment,
  planCapacity,
  workspaceLabel,
  onManage,
}: {
  canManage: boolean
  connectedProviderCount?: number
  currentPlan: WantaSubscriptionPlan | null
  hasSubscription: boolean
  loading?: boolean
  memberCount: number
  memberLoading: boolean
  pendingPayment: WantaPendingPaymentResult | null
  planCapacity: ReturnType<typeof wantaPlanCapacity>
  workspaceLabel: string
  onManage: () => void
}) {
  const t = useT()
  const pendingPaymentUrl = pendingPayment?.paymentURL?.trim() || ""
  return (
    <section className="h-full overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="grid h-full gap-4 p-4">
        <div className="grid min-w-0 gap-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldCheckIcon className="oo-icon-muted size-4 shrink-0" />
                <h2 className="oo-text-title truncate">{t("billing.wantaSubscriptionTitle")}</h2>
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                {loading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  <span className="oo-text-metric text-foreground">
                    {currentPlan ? wantaPlanLabel(currentPlan, t) : t("billing.wantaNoPlan")}
                  </span>
                )}
                {loading ? (
                  <Skeleton className="h-5 w-20 rounded-full" />
                ) : (
                  <Badge variant={hasSubscription ? "secondary" : "outline"}>
                    {hasSubscription ? t("billing.wantaActive") : t("billing.noSubscription")}
                  </Badge>
                )}
                {pendingPaymentUrl ? <Badge variant="outline">{t("billing.wantaPaymentPending")}</Badge> : null}
              </div>
              <p className="oo-text-body mt-2 max-w-2xl text-muted-foreground">
                {t("billing.wantaSubscriptionDescription")}
              </p>
            </div>
            <Button type="button" disabled={loading || !canManage} onClick={onManage}>
              <CreditCardIcon className="size-4" />
              {pendingPaymentUrl ? t("billing.wantaContinuePayment") : t("billing.wantaManagePlan")}
            </Button>
          </div>
          {!canManage ? (
            <div className="oo-text-caption rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
              {t("billing.wantaManagedByCreator")}
            </div>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-3 gap-2 max-[760px]:grid-cols-1">
          <MiniStat
            icon={<UsersIcon className="size-4" />}
            label={t("billing.wantaBillableSeats")}
            value={loading || memberLoading ? "..." : `${memberCount} / ${planCapacity.members}`}
          />
          <MiniStat
            icon={<ShieldCheckIcon className="size-4" />}
            label={t("billing.planComparison.accountsPerApp")}
            value={String(planCapacity.accountsPerApp)}
          />
          <MiniStat
            icon={<GaugeIcon className="size-4" />}
            label={t("billing.wantaSharedLinks")}
            value={connectedProviderCount === undefined ? "--" : Intl.NumberFormat().format(connectedProviderCount)}
          />
        </div>
        <div className="oo-text-caption rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
          {t("billing.wantaPlanStatus", {
            audit: t(planCapacity.auditLogKey),
            report: t(planCapacity.reportKey),
            workspace: workspaceLabel,
          })}
        </div>
      </div>
    </section>
  )
}

function wantaPlanLabel(plan: WantaSubscriptionPlan, t: ReturnType<typeof useT>): string {
  return plan === "wanta_pro" ? t("billing.wantaProPlanTitle") : t("billing.wantaPlusPlanTitle")
}

function ProUpgradeRecommendation({
  currentPlan,
  memberCount,
  totalEvents,
  onUpgrade,
}: {
  currentPlan: WantaSubscriptionPlan | null
  memberCount: number
  totalEvents: number
  onUpgrade: () => void
}) {
  const t = useT()
  const titleKey = currentPlan ? "billing.proRecommendation.plusTitle" : "billing.proRecommendation.freeTitle"
  const descriptionKey = currentPlan
    ? "billing.proRecommendation.plusDescription"
    : "billing.proRecommendation.freeDescription"
  return (
    <section className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheckIcon className="oo-icon-muted size-4 shrink-0" />
            <h2 className="oo-text-title truncate text-foreground">{t(titleKey)}</h2>
          </div>
          <p className="oo-text-body max-w-3xl text-muted-foreground">
            {t(descriptionKey, {
              calls: Intl.NumberFormat().format(totalEvents),
              members: memberCount,
            })}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat
              icon={<UsersIcon className="size-4" />}
              label={t("billing.planComparison.maxMembers")}
              value={String(wantaPlanLimits.wanta_pro.members)}
            />
            <MiniStat
              icon={<GaugeIcon className="size-4" />}
              label={t("billing.planComparison.accountsPerApp")}
              value={String(wantaPlanLimits.wanta_pro.accountsPerApp)}
            />
            <MiniStat
              icon={<ListIcon className="size-4" />}
              label={t("billing.planComparison.reports")}
              value={t(wantaPlanLimits.wanta_pro.reportKey)}
            />
          </div>
        </div>
        <Button type="button" className="self-start" onClick={onUpgrade}>
          {t("billing.proRecommendation.cta")}
        </Button>
      </div>
    </section>
  )
}

function PlanComparison({
  currentPlan,
  onChoosePlan,
}: {
  currentPlan: WantaSubscriptionPlan | null
  onChoosePlan: () => void
}) {
  const t = useT()
  return (
    <BillingPanel title={t("billing.planComparison.title")} meta={t("billing.planComparison.meta")}>
      <div className="grid gap-3">
        <WantaPromotionNotice />
        <div className="grid gap-3 md:grid-cols-2">
          <PlanComparisonCard
            current={currentPlan === "wanta_plus"}
            description={t("billing.planComparison.plusDescription")}
            features={[
              t("billing.planComparison.plusMembers"),
              t("billing.planComparison.plusAccounts"),
              t("billing.planComparison.plusAudit"),
              t("billing.planComparison.plusReport"),
              t("billing.planComparison.plusCredits"),
            ]}
            discountPrice={t("billing.wantaPlusPlanDiscountPrice")}
            originalPrice={t("billing.wantaPlusPlanOriginalPrice")}
            title={t("billing.wantaPlusPlanTitle")}
            onChoose={onChoosePlan}
          />
          <PlanComparisonCard
            current={currentPlan === "wanta_pro"}
            description={t("billing.planComparison.proDescription")}
            features={[
              t("billing.planComparison.proMembers"),
              t("billing.planComparison.proAccounts"),
              t("billing.planComparison.proPermissions"),
              t("billing.planComparison.proAudit"),
              t("billing.planComparison.proReport"),
              t("billing.planComparison.proCredits"),
            ]}
            discountPrice={t("billing.wantaProPlanDiscountPrice")}
            originalPrice={t("billing.wantaProPlanOriginalPrice")}
            title={t("billing.wantaProPlanTitle")}
            onChoose={onChoosePlan}
          />
        </div>
      </div>
    </BillingPanel>
  )
}

function WantaPromotionNotice() {
  const t = useT()
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] px-4 py-3 text-foreground">
      <GiftIcon className="mt-0.5 size-4 shrink-0 text-[var(--oo-success-foreground)]" />
      <div className="min-w-0">
        <div className="oo-text-title">{t("billing.wantaPromotionTitle")}</div>
        <p className="oo-text-body mt-1 text-muted-foreground">{t("billing.wantaPromotionDescription")}</p>
      </div>
    </div>
  )
}

function PlanComparisonCard({
  current,
  description,
  discountPrice,
  features,
  originalPrice,
  title,
  onChoose,
}: {
  current: boolean
  description: string
  discountPrice: string
  features: string[]
  originalPrice: string
  title: string
  onChoose: () => void
}) {
  const t = useT()
  return (
    <article className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="oo-text-title text-foreground">{title}</div>
          <p className="oo-text-body mt-1 text-muted-foreground">{description}</p>
        </div>
        {current ? <Badge variant="secondary">{t("billing.subscriptions.currentSubscriptionButton")}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-baseline">
          <span className="text-3xl leading-none font-semibold text-foreground tabular-nums">{discountPrice}</span>
          <span className="oo-text-body ml-1 text-muted-foreground">{t("billing.subscriptions.priceUnit")}</span>
        </span>
        <span className="oo-text-body text-muted-foreground tabular-nums line-through">{originalPrice}</span>
        <Badge variant="success">{t("billing.wantaPromotionBadge")}</Badge>
      </div>
      <div className="grid gap-2">
        {features.map((feature) => (
          <div key={feature} className="oo-text-body flex items-start gap-2 text-foreground">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{feature}</span>
          </div>
        ))}
      </div>
      <Button type="button" variant={current ? "outline" : "default"} disabled={current} onClick={onChoose}>
        {current ? t("billing.subscriptions.currentSubscriptionButton") : t("billing.planComparison.choosePlan")}
      </Button>
    </article>
  )
}

function PeriodToggle({
  onChange,
  period,
}: {
  onChange: (period: BillingPeriodDays) => void
  period: BillingPeriodDays
}) {
  const t = useT()
  return (
    <ToggleGroup
      type="single"
      value={String(period)}
      onValueChange={(value) => {
        const next = Number(value)
        if (periods.includes(next as BillingPeriodDays)) {
          onChange(next as BillingPeriodDays)
        }
      }}
      variant="outline"
      size="sm"
      aria-label={t("billing.period")}
      className="flex-wrap"
    >
      {periods.map((value) => (
        <ToggleGroupItem key={value} value={String(value)}>
          {t(`billing.period${value}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function BalanceOverview({
  averageDailySpend,
  availableShare,
  modelSpend,
  coverageDays,
  currentCredit,
  loading,
  onTopUp,
  totalEvents,
  totalSpend,
}: {
  averageDailySpend: number
  availableShare: number
  modelSpend: number
  coverageDays: number
  currentCredit: number
  loading: boolean
  onTopUp: () => void
  totalEvents: number
  totalSpend: number
}) {
  const t = useT()
  return (
    <section className="h-full overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="grid h-full gap-4 p-4 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <PiggyBankIcon className="oo-icon-muted size-4 shrink-0" />
                <h2 className="oo-text-title truncate">{t("billing.availableCredits")}</h2>
              </div>
              <div className="oo-text-metric-large mt-2 text-foreground">
                {loading ? "..." : formatCredit(currentCredit)}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onTopUp}>
              {t("billing.topUpBalance")}
            </Button>
          </div>

          <div className="grid gap-2">
            <Progress value={availableShare} className="h-1.5 bg-muted" />
            <div className="oo-text-caption flex flex-wrap items-center justify-between gap-2">
              <span>
                {totalSpend > 0 ? t("billing.coverage", { days: coverageDays }) : t("billing.coverageStable")}
              </span>
              <span>{t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}</span>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-3 gap-2 max-[760px]:grid-cols-1">
          <MiniStat
            icon={<SparklesIcon className="size-4" />}
            label={t("billing.periodSpend")}
            value={loading ? "..." : formatCredit(totalSpend)}
          />
          <MiniStat
            icon={<MessageCircleIcon className="size-4" />}
            label={t("billing.modelSpend")}
            value={loading ? "..." : formatCredit(modelSpend)}
          />
          <MiniStat
            icon={<ListIcon className="size-4" />}
            label={t("billing.callCount")}
            value={loading ? "..." : Intl.NumberFormat().format(totalEvents)}
          />
        </div>
      </div>
    </section>
  )
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md bg-[var(--oo-inspector-surface)] px-3 py-2.5">
      <div className="oo-text-caption flex min-w-0 items-center gap-1.5">
        <span className="oo-icon-muted shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="oo-text-value truncate text-foreground">{value}</div>
    </div>
  )
}

function BillingPanel({
  bodyClassName,
  children,
  meta,
  title,
}: {
  bodyClassName?: string
  children: React.ReactNode
  meta?: string
  title: string
}) {
  return (
    <section className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
        <h2 className="oo-text-title truncate text-foreground">{title}</h2>
        {meta ? <span className="oo-text-caption shrink-0 truncate text-right">{meta}</span> : null}
      </div>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  )
}

function LoadingRows({ count }: { count: number }) {
  return (
    <div className="grid gap-2 p-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-md" />
      ))}
    </div>
  )
}

function CategorySpendList({ summaries, total }: { summaries: CategorySummary[]; total: number }) {
  const t = useT()
  return (
    <div className="grid gap-0">
      {categoryOrder.map((category) => {
        const summary = getSummary(summaries, category)
        const share = total > 0 ? (summary.credit * 100) / total : 0
        return (
          <div
            key={category}
            className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0"
          >
            <div className="grid size-8 place-items-center rounded-md bg-[var(--oo-inspector-surface)] text-muted-foreground">
              {categoryIcon(category)}
            </div>
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="oo-text-title truncate text-foreground">{t(`billing.category.${category}`)}</div>
                  <div className="oo-text-caption truncate">
                    {t("billing.categoryCalls", { count: Intl.NumberFormat().format(summary.eventCount) })}
                  </div>
                </div>
              </div>
              <Progress value={share} className="h-1.5 bg-muted" />
            </div>
            <div className="text-right">
              <div className="oo-text-title text-foreground">{formatCredit(summary.credit)}</div>
              <div className="oo-text-caption">{formatPercent(share)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BalanceLots({ lots }: { lots: CreditItem[] }) {
  const t = useT()
  const sortedLots = [...lots].sort((left, right) => Number(right.currentCredit) - Number(left.currentCredit))
  if (sortedLots.length === 0) {
    return <div className="oo-text-body py-8 text-center text-muted-foreground">{t("billing.emptyBalanceLots")}</div>
  }
  return (
    <div className="grid gap-0">
      {sortedLots.slice(0, 3).map((lot) => (
        <BalanceLotRow key={lot.id} lot={lot} />
      ))}
      {sortedLots.length > 3 ? (
        <div className="oo-text-caption flex items-center justify-between gap-3 border-t border-[var(--oo-divider)] px-3 py-2.5">
          <span>{t("billing.hiddenBalanceLots", { count: sortedLots.length - 3 })}</span>
          <Badge variant="outline">{t("billing.viewAllBalanceLots")}</Badge>
        </div>
      ) : null}
    </div>
  )
}

function BalanceLotRow({ lot }: { lot: CreditItem }) {
  const t = useT()
  const current = toNumber(lot.currentCredit)
  const original = toNumber(lot.originalCredit)
  const share = original > 0 ? Math.max(0, Math.min(100, (current / original) * 100)) : 0
  return (
    <div className="grid min-h-14 gap-2 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="oo-text-title truncate text-foreground">{balanceSourceLabel(lot.sourceType, t)}</div>
          <div className="oo-text-caption truncate">
            {lot.expiresAt ? t("billing.expiresAt", { date: formatDate(lot.expiresAt) }) : t("billing.neverExpires")}
          </div>
        </div>
        <div className="oo-text-title shrink-0 text-right text-foreground">
          {formatCredit(current)}
          <div className="oo-text-caption">{formatCredit(original)}</div>
        </div>
      </div>
      <Progress value={share} className="h-1.5 bg-muted" />
    </div>
  )
}

function TrendChart({
  buckets,
  maxDailySpend,
}: {
  buckets: ReturnType<typeof buildDailySpendBuckets>
  maxDailySpend: number
}) {
  const t = useT()
  return (
    <div
      className="grid min-h-36 items-end gap-1 px-3 py-3"
      style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
      aria-label={t("billing.trendTitle")}
    >
      {buckets.map((bucket) => {
        const height = maxDailySpend > 0 ? Math.max(2, (bucket.credit / maxDailySpend) * 100) : 0
        return (
          <div
            key={bucket.key}
            className="flex h-28 min-w-0 items-end justify-center"
            title={`${bucket.label}: ${formatCredit(bucket.credit)}`}
          >
            <div
              className={cn(
                "w-full max-w-[12px] rounded-t-md rounded-b-sm",
                bucket.credit > 0 ? "bg-[var(--accent-strong)]" : "bg-muted",
              )}
              style={{ height: `${height}%`, minHeight: 2 }}
            />
          </div>
        )
      })}
    </div>
  )
}

function RecentRecords({ records }: { records: RecentRecord[] }) {
  const t = useT()
  if (records.length === 0) {
    return <div className="oo-text-body py-8 text-center text-muted-foreground">{t("billing.emptyRecords")}</div>
  }
  return (
    <div className="grid gap-0">
      {records.map((record) => {
        return (
          <div
            key={record.id}
            className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[auto_minmax(0,1fr)]"
          >
            <Badge className="justify-self-start" variant={record.category === "link" ? "outline" : "secondary"}>
              {t(`billing.category.${record.category}`)}
            </Badge>
            <div className="min-w-0">
              <div className="oo-text-title truncate text-foreground">{record.subject || record.source}</div>
              <div className="oo-text-caption truncate">
                {record.eventCount === undefined
                  ? sourceLabel(record.source, t)
                  : `${sourceLabel(record.source, t)} · ${t("billing.categoryCalls", {
                      count: Intl.NumberFormat().format(record.eventCount),
                    })}`}
              </div>
            </div>
            <div className="min-w-28 text-right max-[760px]:col-span-2 max-[760px]:justify-self-start max-[760px]:text-left">
              <div className="oo-text-title text-foreground tabular-nums">{formatCredit(record.amount)}</div>
              <div className="oo-text-caption tabular-nums">{formatDateTime(record.createdAt)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function buildRecentRecords(logs: BillingLogItem[], spendItems: BillingSpendStats["items"]): RecentRecord[] {
  if (logs.length > 0) {
    return logs
      .map((log, index) => ({
        amount: toNumber(log.debitCredit),
        category: usageCategory(log.source, log.subject),
        createdAt: log.createdAt,
        id: log.eventID || log.traceID || `${log.source}:${log.subject}:${log.createdAt}:${index}`,
        source: log.source,
        subject: log.subject,
      }))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 20)
  }
  return spendItems
    .map((item, index) => ({
      amount: billingCredit(item),
      category: usageCategory(item.source, item.subject),
      createdAt: normalizeTimestamp(item.time),
      eventCount: billingEventCount(item),
      id: `${item.source}:${item.subject}:${item.time}:${index}`,
      source: item.source,
      subject: item.subject,
    }))
    .filter((record) => Number.isFinite(record.createdAt) && (record.amount > 0 || (record.eventCount ?? 0) > 0))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 20)
}

function categoryIcon(category: UsageCategory): React.ReactNode {
  if (category === "model") {
    return <MessageCircleIcon className="size-5" />
  }
  if (category === "api") {
    return <ImageIcon className="size-5" />
  }
  return <ShieldCheckIcon className="size-5" />
}

function sourceLabel(source: string, t: ReturnType<typeof useT>): string {
  switch (source) {
    case "SERVICE_LLM":
      return t("billing.source.llm")
    case "SERVICE_FUSION_API":
      return t("billing.source.fusionApi")
    case "SERVICE_STUDIO_SERVER":
      return t("billing.source.studioServer")
    case "SERVICE_CLOUD_TASK":
      return t("billing.source.cloudTask")
    case "SERVICE_AUTH_LINK":
      return t("billing.source.authLink")
    case "SERVICE_OOMOL_CONNECTOR":
      return t("billing.source.connector")
    default:
      return source || t("billing.source.unknown")
  }
}

function balanceSourceLabel(sourceType: string, t: ReturnType<typeof useT>): string {
  if (sourceType === "quota") {
    return t("billing.balanceSource.quota")
  }
  if (sourceType.includes("subscription")) {
    return t("billing.balanceSource.subscription")
  }
  if (sourceType.includes("credits_package")) {
    return t("billing.balanceSource.topup")
  }
  return t("billing.balanceSource.bonus")
}
