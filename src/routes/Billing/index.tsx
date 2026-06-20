import type { BillingLogItem, BillingPeriodDays, CreditItem } from "../../../electron/chat/common.ts"
import type { CategorySummary, UsageCategory } from "./usage.ts"

import {
  CreditCardIcon,
  ImageIcon,
  ListIcon,
  LogInIcon,
  MessageCircleIcon,
  PiggyBankIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import * as React from "react"
import { CreditPurchaseModal } from "./CreditPurchaseModal.tsx"
import {
  buildCategorySummaries,
  buildDailySpendBuckets,
  categoryOrder,
  formatCredit,
  formatDate,
  formatDateTime,
  formatPercent,
  getSummary,
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
import { cn } from "@/lib/utils"

interface BillingRouteProps {
  cacheScope: string
  onBack: () => void
}

const periods: BillingPeriodDays[] = [7, 30, 90]

export function BillingRoute({ cacheScope, onBack }: BillingRouteProps) {
  const t = useT()
  const { login } = useAuth()
  const [period, setPeriod] = React.useState<BillingPeriodDays>(30)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)
  const { data, error, loading, refresh } = useBillingOverview(period, { cacheScope })
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
  const chatSpend = getSummary(summaries, "chat").credit
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
  const recentLogs = React.useMemo(
    () => [...(data?.logs ?? [])].sort((left, right) => right.createdAt - left.createdAt).slice(0, 20),
    [data?.logs],
  )

  return (
    <>
      <PageRouteShell backLabel={t("billing.backToChat")} contentClassName="max-w-[84rem] gap-5" onBack={onBack}>
        <h1 className="oo-text-title text-2xl font-semibold tracking-normal">{t("billing.title")}</h1>

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
            <Button type="button" size="sm" onClick={() => setPurchaseOpen(true)}>
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

        <BalanceOverview
          averageDailySpend={averageDailySpend}
          chatSpend={chatSpend}
          coverageDays={coverageDays}
          currentCredit={currentCredit}
          loading={(loading && !data) || isSessionExpired}
          totalEvents={totalEvents}
          totalSpend={totalSpend}
          availableShare={availableShare}
          onPurchase={() => setPurchaseOpen(true)}
        />

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
          {loading && !data ? <LoadingRows count={5} /> : <RecentRecords logs={recentLogs} />}
        </BillingPanel>
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
  chatSpend,
  coverageDays,
  currentCredit,
  loading,
  onPurchase,
  totalEvents,
  totalSpend,
}: {
  averageDailySpend: number
  availableShare: number
  chatSpend: number
  coverageDays: number
  currentCredit: number
  loading: boolean
  onPurchase: () => void
  totalEvents: number
  totalSpend: number
}) {
  const t = useT()
  return (
    <section className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <PiggyBankIcon className="oo-icon-muted size-4 shrink-0" />
                <h2 className="oo-text-title truncate">{t("billing.availableCredits")}</h2>
              </div>
              <div className="mt-2 text-[1.75rem] leading-9 font-semibold tracking-normal text-foreground">
                {loading ? "..." : formatCredit(currentCredit)}
              </div>
            </div>
            <Button type="button" size="sm" onClick={onPurchase}>
              <CreditCardIcon className="size-4" />
              {t("billing.purchaseCredits")}
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
            label={t("billing.chatSpend")}
            value={loading ? "..." : formatCredit(chatSpend)}
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

function RecentRecords({ logs }: { logs: BillingLogItem[] }) {
  const t = useT()
  if (logs.length === 0) {
    return <div className="oo-text-body py-8 text-center text-muted-foreground">{t("billing.emptyRecords")}</div>
  }
  return (
    <div className="grid gap-0">
      {logs.map((log, index) => {
        const category = usageCategory(log.source, log.subject)
        return (
          <div
            key={`${log.eventID}-${log.traceID}-${log.createdAt}-${index}`}
            className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[auto_minmax(0,1fr)]"
          >
            <Badge className="justify-self-start" variant={category === "other" ? "outline" : "secondary"}>
              {t(`billing.category.${category}`)}
            </Badge>
            <div className="min-w-0">
              <div className="oo-text-title truncate text-foreground">{log.subject || log.source}</div>
              <div className="oo-text-caption truncate">{sourceLabel(log.source, t)}</div>
            </div>
            <div className="min-w-28 text-right max-[760px]:col-span-2 max-[760px]:justify-self-start max-[760px]:text-left">
              <div className="oo-text-title text-foreground tabular-nums">
                {formatCredit(toNumber(log.debitCredit))}
              </div>
              <div className="oo-text-caption tabular-nums">{formatDateTime(log.createdAt)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function categoryIcon(category: UsageCategory): React.ReactNode {
  if (category === "chat") {
    return <MessageCircleIcon className="size-5" />
  }
  if (category === "image") {
    return <ImageIcon className="size-5" />
  }
  return <SparklesIcon className="size-5" />
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
