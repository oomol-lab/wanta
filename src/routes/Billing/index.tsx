import type { BillingPeriodDays } from "../../../electron/chat/common.ts"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import { LogInIcon } from "lucide-react"
import * as React from "react"
import {
  AdditionalSeatsPanel,
  BillingManagePermissionNotice,
  PlanComparison,
  PlanSeatOverviewPanel,
  WantaSubscriptionPreviewDialog,
} from "./BillingSubscriptionPanels.tsx"
import { BalanceOverview, UsageDetailsDisclosure } from "./BillingUsagePanels.tsx"
import { CreditPurchaseModal } from "./CreditPurchaseModal.tsx"
import {
  buildCategorySummaries,
  buildDailySpendBuckets,
  getSummary,
  statsTotalCredit,
  statsTotalEvents,
  toNumber,
} from "./usage.ts"
import { useWantaCheckout } from "./use-wanta-checkout.ts"
import {
  buildWantaSubscriptionOverview,
  isWantaSubscriptionActionDisabled,
  resolveWantaPendingPaymentTargets,
} from "./wanta-subscription-model.ts"
import { useChatService } from "@/components/AppContext"
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { useAuth } from "@/hooks/useAuth"
import { useBillableSeats } from "@/hooks/useBillableSeats"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { billingRequestScopeForWorkspace, canManageWantaBilling } from "@/lib/billing-scope"

interface BillingRouteProps {
  cacheScope: string
  initialTarget?: "credits" | "plans" | null
  onBack: () => void
  sharedConnectorCount?: number
  workspace: WorkspaceSelection
}

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
  const wantaOrganizationId = canManageWantaBilling(workspace) ? workspace.organizationId : null
  const showWantaPlans = wantaOrganizationId !== null
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
  const wantaCheckout = useWantaCheckout({
    currentAdditionalSeats: wantaOverview.additionalSeats,
    openExternalCheckout,
    organizationId: wantaOrganizationId,
    pendingAdditionalSeats: pendingWantaPaymentTargets.additionalSeats,
    pendingPaymentUrl: pendingWantaPaymentUrl || null,
    pendingPlan: pendingWantaPaymentTargets.plan,
    refresh: () => void refresh({ force: true }),
  })
  const wantaLoading = wantaCheckout.loading
  const wantaCheckoutPreview = wantaCheckout.preview
  const wantaActionDisabled = isWantaSubscriptionActionDisabled({
    canManage: billingContext.canManage,
    isSessionExpired,
    isSubmitting: wantaLoading !== null,
  })
  React.useEffect(() => {
    if (initialTarget !== "plans" || !showWantaPlans) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      planComparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialTarget, showWantaPlans])

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

        {showWantaPlans ? (
          <>
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
              onChoosePlan={wantaCheckout.choosePlan}
            />

            <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
              <AdditionalSeatsPanel
                currentAdditionalSeats={wantaOverview.additionalSeats}
                disabled={wantaActionDisabled}
                loading={wantaLoading !== null}
                pendingAdditionalSeats={pendingWantaPaymentTargets.additionalSeats}
                workspaceLabel={billingContext.workspaceLabel}
                onUpdateSeats={wantaCheckout.updateSeats}
              />

              {balanceOverview}
            </section>
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
      <WantaSubscriptionPreviewDialog
        loading={wantaLoading === "checkout"}
        preview={wantaCheckoutPreview}
        onClose={wantaCheckout.closePreview}
        onConfirm={() => void wantaCheckout.confirm()}
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
  memberCount: number
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
    memberCount: Math.max(1, memberCount ?? 1),
    organizationId: workspace.organizationId,
    organizationName,
    workspaceLabel: organizationName || organizationWorkspaceLabel,
  }
}
