import type { BillingPeriodDays, CreditItem } from "../../../electron/chat/common.ts"
import type { CategorySummary, UsageCategory } from "./usage.ts"

import {
  ChevronDownIcon,
  CircleDollarSignIcon,
  CoinsIcon,
  GiftIcon,
  ImageIcon,
  ListIcon,
  MessageCircleIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"
import * as React from "react"
import {
  buildDailySpendBuckets,
  categoryOrder,
  formatCredit,
  formatDate,
  formatPercent,
  getSummary,
  toNumber,
} from "./usage.ts"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const periods: BillingPeriodDays[] = [7, 30, 90]

export function UsageDetailsDisclosure({
  balanceLots,
  dailyBuckets,
  hasEstimatedTrend,
  loading,
  maxDailySpend,
  period,
  summaries,
  showBalanceLots,
  totalSpend,
}: {
  balanceLots: CreditItem[]
  dailyBuckets: ReturnType<typeof buildDailySpendBuckets>
  hasEstimatedTrend: boolean
  loading: boolean
  maxDailySpend: number
  period: BillingPeriodDays
  summaries: CategorySummary[]
  showBalanceLots: boolean
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
            <section className={cn("grid gap-4", showBalanceLots && "xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)]")}>
              <BillingPanel title={t("billing.categoryTitle")} meta={t("billing.categoryMeta")} bodyClassName="p-0">
                {loading ? <LoadingRows count={3} /> : <CategorySpendList summaries={summaries} total={totalSpend} />}
              </BillingPanel>
              {showBalanceLots ? (
                <BillingPanel
                  title={t("billing.balanceLotsTitle")}
                  meta={t("billing.balanceLotsMeta")}
                  bodyClassName="p-0"
                >
                  {loading ? <LoadingRows count={3} /> : <BalanceLots lots={balanceLots} />}
                </BillingPanel>
              ) : null}
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

export function BalanceOverview({
  averageDailySpend,
  availableShare,
  modelSpend,
  coverageDays,
  currentCredit,
  canManageFunding,
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
  canManageFunding: boolean
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
        <h2 className="oo-text-title truncate text-foreground">
          {t(canManageFunding ? "billing.availableCredits" : "billing.fundingAccount")}
        </h2>
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
              {canManageFunding ? (
                <div className="oo-text-metric-large mt-2 text-foreground">
                  {loading ? "..." : formatCredit(currentCredit)}
                </div>
              ) : (
                <div className="mt-2 grid gap-1">
                  <div className="oo-text-title text-foreground">{t("billing.fundingManagedByCreator")}</div>
                  <p className="oo-text-caption text-muted-foreground">{t("billing.fundingMemberDescription")}</p>
                </div>
              )}
            </div>
            {canManageFunding ? (
              <Button type="button" variant="outline" size="sm" disabled={topUpDisabled} onClick={onTopUp}>
                {t("billing.topUpBalance")}
              </Button>
            ) : null}
          </div>

          {canManageFunding ? (
            <div className="grid gap-2">
              <Progress value={availableShare} className="h-1.5 bg-muted" />
              <div className="oo-text-caption flex flex-wrap items-center justify-between gap-2">
                <span>
                  {totalSpend > 0 ? t("billing.coverage", { days: coverageDays }) : t("billing.coverageStable")}
                </span>
                <span>{t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}</span>
              </div>
            </div>
          ) : null}
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
