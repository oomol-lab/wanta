import type { BillingPeriodDays } from "../../../electron/chat/common.ts"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import { LogInIcon } from "lucide-react"
import * as React from "react"
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
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { billingRequestScopeForWorkspace } from "@/lib/billing-scope"

interface BillingRouteProps {
  cacheScope: string
  initialTarget?: "credits" | null
  onBack: () => void
  workspace: WorkspaceSelection
}

export function BillingRoute({ cacheScope, initialTarget, onBack, workspace }: BillingRouteProps) {
  const t = useT()
  const { login } = useAuth()
  const [period, setPeriod] = React.useState<BillingPeriodDays>(30)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)
  const billingRequestScope = React.useMemo(() => billingRequestScopeForWorkspace(workspace), [workspace])
  const { data, error, loading, refresh } = useBillingOverview(period, {
    cacheScope,
    requestScope: billingRequestScope,
  })
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
  React.useEffect(() => {
    if (initialTarget === "credits") {
      setPurchaseOpen(true)
    }
  }, [initialTarget])

  const balanceOverview = (
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

        {balanceOverview}

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
