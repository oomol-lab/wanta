import type { BillingPeriodDays } from "../../../electron/chat/common.ts"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import { LogInIcon } from "lucide-react"
import * as React from "react"
import {
  AdditionalSeatsPanel,
  BillingManagePermissionNotice,
  PlanComparison,
  PlanSeatOverviewPanel,
  UsageSubscriptionPanel,
  TeamSubscriptionPreviewDialog,
} from "./BillingSubscriptionPanels.tsx"
import { BalanceOverview, UsageDetailsDisclosure } from "./BillingUsagePanels.tsx"
import { CreditPurchaseModal } from "./CreditPurchaseModal.tsx"
import { getCurrentUsageSubscription } from "./plans.ts"
import {
  buildTeamSubscriptionOverview,
  isTeamSubscriptionActionDisabled,
  resolveTeamPendingPaymentTargets,
} from "./team-subscription-model.ts"
import {
  buildCategorySummaries,
  buildDailySpendBuckets,
  getSummary,
  statsTotalCredit,
  statsTotalEvents,
  toNumber,
} from "./usage.ts"
import { useTeamCheckout } from "./use-team-checkout.ts"
import { useChatService } from "@/components/AppContext"
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { useAuth } from "@/hooks/useAuth"
import { useBillableSeats } from "@/hooks/useBillableSeats"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { billingRequestScopeForWorkspace, canManageTeamBilling } from "@/lib/billing-scope"

interface BillingRouteProps {
  cacheScope: string
  initialTarget?: "credits" | "plans" | null
  onBack: () => void
  sharedConnectorCount?: number
  titlebarActions: React.ReactNode
  workspace: WorkspaceSelection
}

export function BillingRoute({
  cacheScope,
  initialTarget,
  onBack,
  sharedConnectorCount,
  titlebarActions,
  workspace,
}: BillingRouteProps) {
  const t = useT()
  const { login, state: authState } = useAuth()
  const chatService = useChatService()
  const [period, setPeriod] = React.useState<BillingPeriodDays>(30)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)
  const billingRequestScope = React.useMemo(() => billingRequestScopeForWorkspace(workspace), [workspace])
  const canManageFunding = billingRequestScope?.canManageFunding === true
  const { data, error, loading, refresh } = useBillingOverview(period, {
    cacheScope,
    requestScope: billingRequestScope,
  })
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
        t("billing.organizationWorkspace"),
      ),
    [seatState.count, sharedConnectorCount, t, workspace],
  )
  const teamOverview = React.useMemo(
    () =>
      buildTeamSubscriptionOverview({
        canManage: billingContext.canManage,
        memberCount: billingContext.memberCount,
        pendingPayment: data?.teamPendingPayment ?? null,
        sharedConnectorCount,
        subscription: data?.subscription ?? null,
      }),
    [
      billingContext.canManage,
      billingContext.memberCount,
      data?.subscription,
      data?.teamPendingPayment,
      sharedConnectorCount,
    ],
  )
  const pendingTeamPaymentTargets = React.useMemo(
    () =>
      resolveTeamPendingPaymentTargets({
        currentAdditionalSeats: teamOverview.additionalSeats,
        currentPlan: teamOverview.currentPlan,
        pendingPayment: data?.teamPendingPayment ?? null,
      }),
    [data?.teamPendingPayment, teamOverview.additionalSeats, teamOverview.currentPlan],
  )
  const pendingTeamPaymentUrl = pendingTeamPaymentTargets.paymentUrl
  const currentUsageSubscription = React.useMemo(
    () => getCurrentUsageSubscription(data?.usageSubscription ?? null),
    [data?.usageSubscription],
  )
  const teamId = canManageTeamBilling(workspace) ? workspace.organizationId : null
  const showTeamPlans = teamId !== null
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
    if (canManageFunding) {
      setPurchaseOpen(true)
    }
  }, [canManageFunding])
  const openExternalCheckout = React.useCallback(
    async (url: string) => {
      await chatService.invoke("openExternalUrl", { url })
    },
    [chatService],
  )
  const teamCheckout = useTeamCheckout({
    currentAdditionalSeats: teamOverview.additionalSeats,
    openExternalCheckout,
    teamId,
    pendingAdditionalSeats: pendingTeamPaymentTargets.additionalSeats,
    pendingPaymentUrl: pendingTeamPaymentUrl || null,
    pendingPlan: pendingTeamPaymentTargets.plan,
    refresh: () => void refresh({ force: true }),
  })
  const teamLoading = teamCheckout.loading
  const teamCheckoutPreview = teamCheckout.preview
  const teamActionDisabled =
    isTeamSubscriptionActionDisabled({
      canManage: billingContext.canManage,
      isSessionExpired,
      isSubmitting: teamLoading !== null,
    }) ||
    seatState.count === null ||
    Boolean(seatState.error)
  React.useEffect(() => {
    if (initialTarget !== "plans" || !showTeamPlans) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      planComparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialTarget, showTeamPlans])

  React.useEffect(() => {
    if (initialTarget === "credits" && canManageFunding) {
      setPurchaseOpen(true)
    }
  }, [canManageFunding, initialTarget])

  const balanceOverview = (
    <BalanceOverview
      averageDailySpend={averageDailySpend}
      modelSpend={modelSpend}
      coverageDays={coverageDays}
      currentCredit={currentCredit}
      canManageFunding={canManageFunding}
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
  )

  return (
    <>
      <PageRouteShell
        backLabel={t("billing.backToChat")}
        contentClassName="max-w-[84rem] gap-5"
        onBack={onBack}
        titlebarActions={titlebarActions}
      >
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

        {showTeamPlans ? (
          <>
            <PlanSeatOverviewPanel
              loading={(loading && !data) || isSessionExpired}
              overview={teamOverview}
              seatLoading={seatState.loading}
              seatUnavailable={seatState.count === null || Boolean(seatState.error)}
              workspaceLabel={billingContext.workspaceLabel}
            />

            <PlanComparison
              ref={planComparisonRef}
              currentPlan={teamOverview.currentPlan}
              disabled={teamActionDisabled}
              loadingPlan={teamLoading}
              pendingPaymentPlan={pendingTeamPaymentTargets.plan}
              onChoosePlan={teamCheckout.choosePlan}
            />

            <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
              <AdditionalSeatsPanel
                currentAdditionalSeats={teamOverview.additionalSeats}
                disabled={teamActionDisabled}
                loading={teamLoading !== null}
                pendingAdditionalSeats={pendingTeamPaymentTargets.additionalSeats}
                workspaceLabel={billingContext.workspaceLabel}
                onUpdateSeats={teamCheckout.updateSeats}
              />

              {balanceOverview}
            </section>

            {canManageFunding ? (
              <UsageSubscriptionPanel
                currentPlan={currentUsageSubscription}
                disabled={isSessionExpired || loading || data?.usageSubscriptionAvailable !== true}
                openExternalCheckout={openExternalCheckout}
                userId={authState?.account?.id}
              />
            ) : null}
          </>
        ) : (
          balanceOverview
        )}

        <UsageDetailsDisclosure
          balanceLots={data?.balance?.items ?? []}
          dailyBuckets={dailyBuckets}
          hasEstimatedTrend={hasEstimatedTrend}
          loading={loading && !data}
          maxDailySpend={maxDailySpend}
          period={period}
          summaries={summaries}
          showBalanceLots={canManageFunding}
          totalSpend={totalSpend}
        />
      </PageRouteShell>
      <TeamSubscriptionPreviewDialog
        loading={teamLoading === "checkout"}
        preview={teamCheckoutPreview}
        onClose={teamCheckout.closePreview}
        onConfirm={() => void teamCheckout.confirm()}
      />
      <CreditPurchaseModal
        cacheScope={cacheScope}
        open={purchaseOpen}
        requestScope={billingRequestScope}
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
  memberCount: number | null
  organizationId?: string
  organizationName?: string
  workspaceLabel: string
}

function buildBillingWorkspaceContext(
  workspace: WorkspaceSelection,
  memberCount: number | null,
  connectedProviderCount?: number,
  organizationWorkspaceLabel = "Organization",
): BillingWorkspaceContext {
  const organizationName = workspace.organization?.name ?? ""
  return {
    canManage: workspace.canManage,
    connectedProviderCount,
    memberCount: memberCount === null ? null : Math.max(1, memberCount),
    organizationId: workspace.organizationId,
    organizationName,
    workspaceLabel: organizationName || organizationWorkspaceLabel,
  }
}
