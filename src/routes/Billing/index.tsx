import type { BillingPeriodDays, CreditItem, WantaSubscriptionPlan } from "../../../electron/chat/common.ts"
import type { CategorySummary, UsageCategory } from "./usage.ts"
import type { WantaSubscriptionOverview } from "./wanta-subscription-model.ts"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import {
  CreditCardIcon,
  ChevronDownIcon,
  CircleDollarSignIcon,
  CoinsIcon,
  GiftIcon,
  ImageIcon,
  ListIcon,
  LogInIcon,
  MessageCircleIcon,
  MinusIcon,
  ShieldCheckIcon,
  UsersIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { CreditPurchaseModal } from "./CreditPurchaseModal.tsx"
import {
  buildCategorySummaries,
  buildDailySpendBuckets,
  categoryOrder,
  formatCredit,
  formatDate,
  formatPercent,
  getSummary,
  statsTotalCredit,
  statsTotalEvents,
  toNumber,
} from "./usage.ts"
import { buildWantaSubscriptionOverview, resolveWantaPendingPaymentTargets } from "./wanta-subscription-model.ts"
import { useChatService } from "@/components/AppContext"
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { useBillableSeats } from "@/hooks/useBillableSeats"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { updateWantaSubscription } from "@/lib/billing-client"
import { cn } from "@/lib/utils"

interface BillingRouteProps {
  cacheScope: string
  initialTarget?: "credits" | "plans" | null
  onBack: () => void
  sharedConnectorCount?: number
  workspace: WorkspaceSelection
}

const periods: BillingPeriodDays[] = [7, 30, 90]

export function BillingRoute({
  cacheScope,
  initialTarget,
  onBack,
  sharedConnectorCount,
  workspace,
}: BillingRouteProps) {
  const t = useT()
  const { login } = useAuth()
  const chatService = useChatService()
  const [period, setPeriod] = React.useState<BillingPeriodDays>(30)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)
  const [wantaLoading, setWantaLoading] = React.useState<WantaSubscriptionPlan | "seats" | null>(null)
  const { data, error, loading, refresh } = useBillingOverview(period, { cacheScope })
  const seatState = useBillableSeats(workspace)
  const planComparisonRef = React.useRef<HTMLElement | null>(null)
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
  const wantaOverview = React.useMemo(
    () =>
      buildWantaSubscriptionOverview({
        canManage: billingContext.canManage,
        memberCount: billingContext.memberCount,
        pendingPayment: data?.wantaPendingPayment ?? null,
        sharedConnectorCount,
        subscription: data?.subscription ?? null,
      }),
    [
      billingContext.canManage,
      billingContext.memberCount,
      data?.subscription,
      data?.wantaPendingPayment,
      sharedConnectorCount,
    ],
  )
  const pendingWantaPaymentTargets = React.useMemo(
    () =>
      resolveWantaPendingPaymentTargets({
        currentAdditionalSeats: wantaOverview.additionalSeats,
        currentPlan: wantaOverview.currentPlan,
        pendingPayment: data?.wantaPendingPayment ?? null,
      }),
    [data?.wantaPendingPayment, wantaOverview.additionalSeats, wantaOverview.currentPlan],
  )
  const pendingWantaPaymentUrl = pendingWantaPaymentTargets.paymentUrl
  const wantaActionDisabled = !billingContext.canManage || isSessionExpired || !data || wantaLoading !== null
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
  const openUsagePurchase = React.useCallback(() => {
    setPurchaseOpen(true)
  }, [])
  const openExternalCheckout = React.useCallback(
    async (url: string) => {
      await chatService.invoke("openExternalUrl", { url })
    },
    [chatService],
  )
  const handleWantaPlan = React.useCallback(
    async (plan: WantaSubscriptionPlan) => {
      setWantaLoading(plan)
      try {
        if (pendingWantaPaymentUrl && pendingWantaPaymentTargets.plan === plan) {
          await openExternalCheckout(pendingWantaPaymentUrl)
          return
        }
        const result = await updateWantaSubscription({ plan })
        const paymentUrl = result.paymentURL?.trim()
        if (paymentUrl) {
          await openExternalCheckout(paymentUrl)
          return
        }
        toast.success(t("billing.wantaSubscriptionUpdated"))
        void refresh({ force: true })
      } catch {
        toast.error(t("billing.purchaseDialog.checkoutFailed"))
      } finally {
        setWantaLoading(null)
      }
    },
    [openExternalCheckout, pendingWantaPaymentTargets.plan, pendingWantaPaymentUrl, refresh, t],
  )
  const handleWantaSeats = React.useCallback(
    async (additionalSeats: number) => {
      setWantaLoading("seats")
      try {
        if (pendingWantaPaymentUrl && pendingWantaPaymentTargets.additionalSeats === additionalSeats) {
          await openExternalCheckout(pendingWantaPaymentUrl)
          return
        }
        const result = await updateWantaSubscription({ additional_seats: additionalSeats })
        const paymentUrl = result.paymentURL?.trim()
        if (paymentUrl) {
          await openExternalCheckout(paymentUrl)
          return
        }
        toast.success(t("billing.wantaSubscriptionUpdated"))
        void refresh({ force: true })
      } catch {
        toast.error(t("billing.purchaseDialog.checkoutFailed"))
      } finally {
        setWantaLoading(null)
      }
    },
    [openExternalCheckout, pendingWantaPaymentTargets.additionalSeats, pendingWantaPaymentUrl, refresh, t],
  )

  React.useEffect(() => {
    if (initialTarget !== "plans") {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      planComparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialTarget])

  React.useEffect(() => {
    if (initialTarget === "credits") {
      setPurchaseOpen(true)
    }
  }, [initialTarget])

  return (
    <>
      <PageRouteShell backLabel={t("billing.backToChat")} contentClassName="max-w-[84rem] gap-5" onBack={onBack}>
        <h1 className="oo-text-page-title">{t("billing.title")}</h1>

        <section className="border-b border-[var(--oo-divider)] pb-5">
          <div className="min-w-0">
            <p className="oo-text-body text-muted-foreground">{t("billing.subtitle")}</p>
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

        {!billingContext.canManage ? <BillingManagePermissionNotice /> : null}

        <PlanSeatOverviewPanel
          loading={(loading && !data) || isSessionExpired}
          overview={wantaOverview}
          seatLoading={seatState.loading}
          workspaceLabel={billingContext.workspaceLabel}
        />

        <PlanComparison
          ref={planComparisonRef}
          currentPlan={wantaOverview.currentPlan}
          disabled={wantaActionDisabled}
          loadingPlan={wantaLoading}
          pendingPaymentPlan={pendingWantaPaymentTargets.plan}
          onChoosePlan={handleWantaPlan}
        />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
          <AdditionalSeatsPanel
            currentAdditionalSeats={wantaOverview.additionalSeats}
            disabled={wantaActionDisabled}
            loading={wantaLoading !== null}
            pendingAdditionalSeats={pendingWantaPaymentTargets.additionalSeats}
            workspaceLabel={billingContext.workspaceLabel}
            onUpdateSeats={handleWantaSeats}
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
            period={period}
            topUpDisabled={isSessionExpired}
            onPeriodChange={setPeriod}
            onRefresh={() => void refresh({ force: true })}
            onTopUp={openUsagePurchase}
          />
        </section>

        <UsageDetailsDisclosure
          balanceLots={data?.balance?.items ?? []}
          dailyBuckets={dailyBuckets}
          hasEstimatedTrend={hasEstimatedTrend}
          loading={loading && !data}
          maxDailySpend={maxDailySpend}
          period={period}
          summaries={summaries}
          totalSpend={totalSpend}
        />
      </PageRouteShell>
      <CreditPurchaseModal
        cacheScope={cacheScope}
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

function normalizeAdditionalSeats(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function PlanSeatOverviewPanel({
  loading,
  overview,
  seatLoading,
  workspaceLabel,
}: {
  loading: boolean
  overview: WantaSubscriptionOverview
  seatLoading: boolean
  workspaceLabel: string
}) {
  const t = useT()
  const statusVariant = overview.hasPendingPayment ? "warning" : overview.currentPlan ? "success" : "outline"
  const descriptionKey = overview.hasPendingPayment
    ? "billing.planStatus.pendingDescription"
    : !overview.currentPlan
      ? "billing.planStatus.freeDescription"
      : overview.overCapacity
        ? "billing.planStatus.overCapacityDescription"
        : "billing.planStatus.activeDescription"
  const seatValue =
    loading || seatLoading
      ? "..."
      : overview.seatCapacity === null
        ? t("billing.planStatus.members", { count: overview.usedSeats })
        : `${overview.usedSeats}/${overview.seatCapacity}`

  return (
    <BillingPanel title={t("billing.planStatus.title")} meta={workspaceLabel}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <ShieldCheckIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="oo-text-title text-foreground">
                {overview.currentPlan ? wantaPlanLabel(overview.currentPlan, t) : t("billing.wantaNoPlan")}
              </h3>
              <Badge variant={statusVariant}>
                {overview.hasPendingPayment
                  ? t("billing.wantaPaymentPending")
                  : overview.currentPlan
                    ? t("billing.wantaActive")
                    : t("billing.popover.planInactive")}
              </Badge>
            </div>
            <p className="oo-text-body mt-2 text-muted-foreground">{t(descriptionKey)}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <MiniStat icon={<UsersIcon className="size-4" />} label={t("billing.planStatus.seats")} value={seatValue} />
          <MiniStat
            icon={<PlusIcon className="size-4" />}
            label={t("billing.additionalSeats.current")}
            value={loading ? "..." : String(overview.additionalSeats)}
          />
          <MiniStat
            icon={<ShieldCheckIcon className="size-4" />}
            label={t("billing.planStatus.accountsPerApp")}
            value={loading ? "..." : String(overview.accountsPerApp)}
          />
          <MiniStat
            icon={<ListIcon className="size-4" />}
            label={t("billing.wantaSharedLinks")}
            value={overview.sharedConnectorCount === undefined ? "--" : String(overview.sharedConnectorCount)}
          />
        </div>
      </div>
    </BillingPanel>
  )
}

const PlanComparison = React.forwardRef<
  HTMLElement,
  {
    currentPlan: WantaSubscriptionPlan | null
    disabled: boolean
    loadingPlan: WantaSubscriptionPlan | "seats" | null
    pendingPaymentPlan: WantaSubscriptionPlan | null
    onChoosePlan: (plan: WantaSubscriptionPlan) => void
  }
>(function PlanComparison({ currentPlan, disabled, loadingPlan, pendingPaymentPlan, onChoosePlan }, ref) {
  const t = useT()
  return (
    <BillingPanel
      ref={ref}
      className="scroll-mt-3"
      title={t("billing.planComparison.title")}
      meta={t("billing.planComparison.meta")}
    >
      <div className="grid gap-3">
        <WantaPromotionNotice />
        <div className="grid gap-3 md:grid-cols-2">
          <PlanComparisonCard
            current={currentPlan === "wanta_plus"}
            description={t("billing.planComparison.plusDescription")}
            features={[
              t("billing.planComparison.planning"),
              t("billing.planComparison.sharedLinks"),
              t("billing.planComparison.orgGovernance"),
              t("billing.planComparison.plusMembers"),
              t("billing.planComparison.plusAccounts"),
            ]}
            discountPrice={t("billing.wantaPlusPlanDiscountPrice")}
            disabled={disabled}
            loading={loadingPlan === "wanta_plus"}
            originalPrice={t("billing.wantaPlusPlanOriginalPrice")}
            pendingPayment={pendingPaymentPlan === "wanta_plus"}
            plan="wanta_plus"
            title={t("billing.wantaPlusPlanTitle")}
            onChoose={onChoosePlan}
          />
          <PlanComparisonCard
            current={currentPlan === "wanta_pro"}
            description={t("billing.planComparison.proDescription")}
            features={[
              t("billing.planComparison.planning"),
              t("billing.planComparison.sharedLinks"),
              t("billing.planComparison.advancedGovernance"),
              t("billing.planComparison.proMembers"),
              t("billing.planComparison.proAccounts"),
            ]}
            discountPrice={t("billing.wantaProPlanDiscountPrice")}
            disabled={disabled}
            loading={loadingPlan === "wanta_pro"}
            originalPrice={t("billing.wantaProPlanOriginalPrice")}
            pendingPayment={pendingPaymentPlan === "wanta_pro"}
            plan="wanta_pro"
            title={t("billing.wantaProPlanTitle")}
            onChoose={onChoosePlan}
          />
        </div>
      </div>
    </BillingPanel>
  )
})

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

function BillingManagePermissionNotice() {
  const t = useT()
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-4 py-3 text-foreground">
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--oo-warning-foreground)]" />
      <div className="min-w-0">
        <div className="oo-text-title">{t("billing.managePermission.title")}</div>
        <p className="oo-text-body mt-1 text-muted-foreground">{t("billing.managePermission.description")}</p>
      </div>
    </div>
  )
}

function PlanComparisonCard({
  current,
  description,
  disabled,
  discountPrice,
  features,
  loading,
  originalPrice,
  pendingPayment,
  plan,
  title,
  onChoose,
}: {
  current: boolean
  description: string
  disabled: boolean
  discountPrice: string
  features: string[]
  loading: boolean
  originalPrice: string
  pendingPayment: boolean
  plan: WantaSubscriptionPlan
  title: string
  onChoose: (plan: WantaSubscriptionPlan) => void
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
      <Button
        type="button"
        variant={current ? "outline" : "default"}
        disabled={disabled || (current && !pendingPayment) || loading}
        onClick={() => onChoose(plan)}
      >
        {loading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
        {pendingPayment
          ? t("billing.wantaContinuePayment")
          : current
            ? t("billing.subscriptions.currentSubscriptionButton")
            : t("billing.planComparison.choosePlan")}
      </Button>
    </article>
  )
}

function AdditionalSeatsPanel({
  currentAdditionalSeats,
  disabled,
  loading,
  pendingAdditionalSeats,
  workspaceLabel,
  onUpdateSeats,
}: {
  currentAdditionalSeats: number
  disabled: boolean
  loading: boolean
  pendingAdditionalSeats: number | null
  workspaceLabel: string
  onUpdateSeats: (additionalSeats: number) => void
}) {
  const t = useT()
  const [additionalSeats, setAdditionalSeats] = React.useState(currentAdditionalSeats)

  React.useEffect(() => {
    setAdditionalSeats(pendingAdditionalSeats ?? currentAdditionalSeats)
  }, [currentAdditionalSeats, pendingAdditionalSeats])

  const unchanged = additionalSeats === currentAdditionalSeats
  const pendingTargetSelected = pendingAdditionalSeats !== null && additionalSeats === pendingAdditionalSeats
  const controlDisabled = disabled || loading
  const actionDisabled = controlDisabled || (!pendingTargetSelected && unchanged)

  return (
    <BillingPanel title={t("billing.additionalSeats.title")} meta={t("billing.additionalSeats.meta")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="grid gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <UsersIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="oo-text-title text-foreground">{t("billing.additionalSeats.cardTitle")}</h3>
              <p className="oo-text-body mt-1 text-muted-foreground">
                {t("billing.additionalSeats.description", { workspace: workspaceLabel })}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniStat
              icon={<UsersIcon className="size-4" />}
              label={t("billing.additionalSeats.current")}
              value={String(currentAdditionalSeats)}
            />
            <MiniStat
              icon={<CreditCardIcon className="size-4" />}
              label={t("billing.additionalSeats.unitPrice")}
              value={t("billing.additionalSeats.price")}
            />
          </div>
        </div>

        <div className="grid content-start gap-3 justify-self-end rounded-md border border-border p-3 max-[760px]:w-full sm:w-[17rem]">
          <div className="oo-text-label text-muted-foreground">{t("billing.additionalSeats.inputLabel")}</div>
          <div className="grid w-full grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-full"
              disabled={controlDisabled || additionalSeats <= 0}
              onClick={() => setAdditionalSeats((count) => Math.max(0, count - 1))}
            >
              <MinusIcon className="size-4" />
            </Button>
            <Input
              className="h-9 w-full text-center tabular-nums"
              disabled={controlDisabled}
              min={0}
              step={1}
              type="number"
              value={additionalSeats}
              onChange={(event) => setAdditionalSeats(normalizeAdditionalSeats(event.currentTarget.value))}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-full"
              disabled={controlDisabled}
              onClick={() => setAdditionalSeats((count) => count + 1)}
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full"
            disabled={actionDisabled}
            onClick={() => onUpdateSeats(additionalSeats)}
          >
            {loading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {pendingTargetSelected ? t("billing.wantaContinuePayment") : t("billing.wantaManageSeats")}
          </Button>
        </div>
      </div>
    </BillingPanel>
  )
}

function UsageDetailsDisclosure({
  balanceLots,
  dailyBuckets,
  hasEstimatedTrend,
  loading,
  maxDailySpend,
  period,
  summaries,
  totalSpend,
}: {
  balanceLots: CreditItem[]
  dailyBuckets: ReturnType<typeof buildDailySpendBuckets>
  hasEstimatedTrend: boolean
  loading: boolean
  maxDailySpend: number
  period: BillingPeriodDays
  summaries: CategorySummary[]
  totalSpend: number
}) {
  const t = useT()
  return (
    <Collapsible>
      <section className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <CollapsibleTrigger className="group flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left">
          <div className="min-w-0">
            <h2 className="oo-text-title truncate text-foreground">{t("billing.usageDetails.title")}</h2>
            <p className="oo-text-caption truncate text-muted-foreground">{t("billing.usageDetails.description")}</p>
          </div>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-4 border-t border-[var(--oo-divider)] bg-muted/20 p-3">
            <BillingPanel
              title={t("billing.trendTitle")}
              meta={t(hasEstimatedTrend ? "billing.trendEstimatedMeta" : "billing.trendMeta", { days: period })}
              bodyClassName="p-0"
            >
              {loading ? (
                <Skeleton className="m-3 h-36" />
              ) : (
                <TrendChart buckets={dailyBuckets} maxDailySpend={maxDailySpend} />
              )}
            </BillingPanel>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)]">
              <BillingPanel title={t("billing.categoryTitle")} meta={t("billing.categoryMeta")} bodyClassName="p-0">
                {loading ? <LoadingRows count={3} /> : <CategorySpendList summaries={summaries} total={totalSpend} />}
              </BillingPanel>
              <BillingPanel
                title={t("billing.balanceLotsTitle")}
                meta={t("billing.balanceLotsMeta")}
                bodyClassName="p-0"
              >
                {loading ? <LoadingRows count={3} /> : <BalanceLots lots={balanceLots} />}
              </BillingPanel>
            </section>
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
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
  period,
  topUpDisabled,
  onPeriodChange,
  onRefresh,
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
  period: BillingPeriodDays
  topUpDisabled: boolean
  onPeriodChange: (period: BillingPeriodDays) => void
  onRefresh: () => void
  onTopUp: () => void
  totalEvents: number
  totalSpend: number
}) {
  const t = useT()
  return (
    <section className="h-full overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
        <h2 className="oo-text-title truncate text-foreground">{t("billing.availableCredits")}</h2>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <PeriodToggle period={period} onChange={onPeriodChange} />
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
            <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
            {t("billing.refresh")}
          </Button>
        </div>
      </div>
      <div className="grid h-[calc(100%-2.75rem)] gap-4 p-4 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <PiggyBankIcon className="oo-icon-muted size-4 shrink-0" />
              <div className="oo-text-metric-large mt-2 text-foreground">
                {loading ? "..." : formatCredit(currentCredit)}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={topUpDisabled} onClick={onTopUp}>
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
    <div className="grid min-w-0 gap-1 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="oo-text-caption flex min-w-0 items-center gap-1.5">
        <span className="oo-icon-muted shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="oo-text-value truncate text-foreground">{value}</div>
    </div>
  )
}

const BillingPanel = React.forwardRef<
  HTMLElement,
  {
    bodyClassName?: string
    children: React.ReactNode
    className?: string
    meta?: string
    title: string
  }
>(function BillingPanel({ bodyClassName, children, className, meta, title }, ref) {
  return (
    <section
      ref={ref}
      className={cn("overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background", className)}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
        <h2 className="oo-text-title truncate text-foreground">{title}</h2>
        {meta ? <span className="oo-text-caption shrink-0 truncate text-right">{meta}</span> : null}
      </div>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  )
})

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
  const [expanded, setExpanded] = React.useState(false)
  const sortedLots = [...lots].sort((left, right) => Number(right.currentCredit) - Number(left.currentCredit))
  if (sortedLots.length === 0) {
    return <div className="oo-text-body py-8 text-center text-muted-foreground">{t("billing.emptyBalanceLots")}</div>
  }
  const visibleLots = expanded ? sortedLots : sortedLots.slice(0, 3)
  const hiddenCount = sortedLots.length - visibleLots.length
  return (
    <div className="grid gap-0">
      {visibleLots.map((lot) => (
        <BalanceLotRow key={lot.id} lot={lot} />
      ))}
      {sortedLots.length > 3 ? (
        <div className="oo-text-caption flex items-center justify-between gap-3 bg-muted/20 px-3 py-2.5">
          <span>
            {expanded ? t("billing.allBalanceLotsShown") : t("billing.hiddenBalanceLots", { count: hiddenCount })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t("billing.collapseBalanceLots") : t("billing.viewAllBalanceLots")}
          </Button>
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
    <div className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0">
      <div className="grid size-8 place-items-center rounded-md bg-[var(--oo-inspector-surface)] text-muted-foreground">
        {balanceSourceIcon(lot.sourceType)}
      </div>
      <div className="grid min-w-0 gap-1.5">
        <div className="min-w-0">
          <div className="oo-text-title truncate text-foreground">{balanceSourceLabel(lot.sourceType, t)}</div>
          <div className="oo-text-caption truncate">
            {lot.expiresAt ? t("billing.expiresAt", { date: formatDate(lot.expiresAt) }) : t("billing.neverExpires")}
          </div>
        </div>
        <Progress value={share} className="h-1.5 bg-muted" />
      </div>
      <div className="oo-text-title shrink-0 text-right text-foreground">
        {formatCredit(current)}
        <div className="oo-text-caption">{formatCredit(original)}</div>
      </div>
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

function categoryIcon(category: UsageCategory): React.ReactNode {
  if (category === "model") {
    return <MessageCircleIcon className="size-5" />
  }
  if (category === "api") {
    return <ImageIcon className="size-5" />
  }
  return <ShieldCheckIcon className="size-5" />
}

function wantaPlanLabel(plan: WantaSubscriptionPlan, t: ReturnType<typeof useT>): string {
  return plan === "wanta_pro" ? t("billing.wantaProPlanTitle") : t("billing.wantaPlusPlanTitle")
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

function balanceSourceIcon(sourceType: string): React.ReactNode {
  if (sourceType === "quota") {
    return <CoinsIcon className="size-5" />
  }
  if (sourceType.includes("subscription")) {
    return <ReceiptTextIcon className="size-5" />
  }
  if (sourceType.includes("credits_package")) {
    return <CircleDollarSignIcon className="size-5" />
  }
  return <GiftIcon className="size-5" />
}
