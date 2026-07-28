import type { BillingPeriodDays, CreditItem } from "../../../electron/chat/common.ts"
import type { CategorySummary, SubjectSummary, UsageCategory } from "./usage.ts"

import {
  ChevronDownIcon,
  CircleDollarSignIcon,
  CoinsIcon,
  DownloadIcon,
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
  formatDateTime,
  formatPercent,
  getSummary,
  normalizeTimestamp,
  toNumber,
} from "./usage.ts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

// Only windows the Insight V2 daily route can serve (daily cap = 30 days); see BillingPeriodDays.
const periods: BillingPeriodDays[] = [7, 14, 30]

export function UsageDetailsDisclosure({
  balanceLots,
  dataAsOf,
  dailyBuckets,
  hasEstimatedTrend,
  loading,
  maxDailySpend,
  period,
  meteringAvailable,
  open,
  summaries,
  showBalanceLots,
  spendAvailable,
  subjectSummaries,
  totalSpend,
  onOpenChange,
}: {
  balanceLots: CreditItem[]
  dataAsOf?: number
  dailyBuckets: ReturnType<typeof buildDailySpendBuckets>
  hasEstimatedTrend: boolean
  loading: boolean
  maxDailySpend: number
  period: BillingPeriodDays
  meteringAvailable: boolean
  open: boolean
  summaries: CategorySummary[]
  showBalanceLots: boolean
  spendAvailable: boolean
  subjectSummaries: SubjectSummary[]
  totalSpend: number
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const connectorAggregate = getSummary(summaries, "link")
  const canExport = subjectSummaries.length > 0 || connectorAggregate.credit > 0 || connectorAggregate.eventCount > 0
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
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
            <BillingPanel
              title={t("billing.breakdown.title")}
              meta={
                dataAsOf
                  ? t("billing.breakdown.metaAsOf", { date: formatDateTime(dataAsOf) })
                  : t("billing.breakdown.meta")
              }
              bodyClassName="p-0"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || !canExport}
                  onClick={() =>
                    exportUsageCsv(subjectSummaries, connectorAggregate, period, dataAsOf, {
                      metering: meteringAvailable,
                      spend: spendAvailable,
                    })
                  }
                >
                  <DownloadIcon data-icon="inline-start" />
                  {t("billing.breakdown.export")}
                </Button>
              }
            >
              {loading ? (
                <LoadingRows count={4} />
              ) : (
                <SubjectBreakdown
                  connectorAggregate={connectorAggregate}
                  meteringAvailable={meteringAvailable}
                  spendAvailable={spendAvailable}
                  summaries={subjectSummaries}
                  totalSpend={totalSpend}
                />
              )}
            </BillingPanel>
            <section className={cn("grid gap-4", showBalanceLots && "xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)]")}>
              <BillingPanel title={t("billing.categoryTitle")} meta={t("billing.categoryMeta")} bodyClassName="p-0">
                {loading ? (
                  <LoadingRows count={3} />
                ) : (
                  <CategorySpendList
                    meteringAvailable={meteringAvailable}
                    spendAvailable={spendAvailable}
                    summaries={summaries}
                    subjectSummaries={subjectSummaries}
                    total={totalSpend}
                  />
                )}
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
  balanceAvailable,
  modelSpend,
  coverageDays,
  showCoverageDays,
  currentCredit,
  canManageFunding,
  hasNoUsage,
  loading,
  meteringAvailable,
  period,
  spendAvailable,
  topUpDisabled,
  onPeriodChange,
  onRefresh,
  onTopUp,
  totalEvents,
  totalSpend,
}: {
  averageDailySpend: number
  availableShare: number
  balanceAvailable: boolean
  modelSpend: number
  coverageDays: number
  showCoverageDays: boolean
  currentCredit: number
  canManageFunding: boolean
  hasNoUsage: boolean
  loading: boolean
  meteringAvailable: boolean
  period: BillingPeriodDays
  spendAvailable: boolean
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
                  {loading ? "..." : balanceAvailable ? formatCredit(currentCredit) : "—"}
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
              {balanceAvailable ? <Progress value={availableShare} className="h-1.5 bg-muted" /> : null}
              <div className="oo-text-caption flex flex-wrap items-center justify-between gap-2">
                <span>
                  {!spendAvailable
                    ? t("billing.usageUnavailable")
                    : hasNoUsage
                      ? t("billing.popover.noUsageTitle")
                      : showCoverageDays
                        ? t("billing.coverage", { days: coverageDays })
                        : t("billing.coverageStable")}
                </span>
                {spendAvailable && !hasNoUsage ? (
                  <span>{t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {hasNoUsage ? (
          <div className="oo-text-caption flex min-h-24 items-center rounded-md border border-dashed border-border px-4 text-muted-foreground">
            {t("billing.popover.noUsageDescription")}
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-3 gap-2 max-[760px]:grid-cols-1">
            <MiniStat
              icon={<SparklesIcon className="size-4" />}
              label={t("billing.periodSpend")}
              value={loading ? "..." : spendAvailable ? formatCredit(totalSpend) : "—"}
            />
            <MiniStat
              icon={<MessageCircleIcon className="size-4" />}
              label={t("billing.modelSpend")}
              value={loading ? "..." : spendAvailable ? formatCredit(modelSpend) : "—"}
            />
            <MiniStat
              icon={<ListIcon className="size-4" />}
              label={t("billing.callCount")}
              value={loading ? "..." : meteringAvailable ? Intl.NumberFormat().format(totalEvents) : "—"}
            />
          </div>
        )}
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
    action?: React.ReactNode
    meta?: string
    title: string
  }
>(function BillingPanel({ action, bodyClassName, children, className, meta, title }, ref) {
  return (
    <section
      ref={ref}
      className={cn("overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background", className)}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
        <h2 className="oo-text-title truncate text-foreground">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {meta ? <span className="oo-text-caption truncate text-right">{meta}</span> : null}
          {action}
        </div>
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

function CategorySpendList({
  meteringAvailable,
  spendAvailable,
  summaries,
  subjectSummaries,
  total,
}: {
  meteringAvailable: boolean
  spendAvailable: boolean
  summaries: CategorySummary[]
  subjectSummaries: SubjectSummary[]
  total: number
}) {
  const t = useT()
  const connectorAppCount = subjectSummaries.filter((summary) => summary.category === "link").length
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
                    {category === "link" && connectorAppCount > 0
                      ? t("billing.categoryConnectorApps", {
                          apps: Intl.NumberFormat().format(connectorAppCount),
                          count: meteringAvailable ? Intl.NumberFormat().format(summary.eventCount) : "—",
                        })
                      : category === "link" && (summary.eventCount > 0 || summary.credit > 0)
                        ? t("billing.categoryConnectorAggregateOnly", {
                            count: meteringAvailable ? Intl.NumberFormat().format(summary.eventCount) : "—",
                          })
                        : meteringAvailable
                          ? t("billing.categoryCalls", { count: Intl.NumberFormat().format(summary.eventCount) })
                          : t("billing.breakdown.unavailable")}
                  </div>
                </div>
              </div>
              <Progress value={share} className="h-1.5 bg-muted" />
            </div>
            <div className="text-right">
              <div className="oo-text-title text-foreground">{spendAvailable ? formatCredit(summary.credit) : "—"}</div>
              <div className="oo-text-caption">{spendAvailable ? formatPercent(share) : "—"}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SubjectBreakdown({
  connectorAggregate,
  meteringAvailable,
  spendAvailable,
  summaries,
  totalSpend,
}: {
  connectorAggregate: CategorySummary
  meteringAvailable: boolean
  spendAvailable: boolean
  summaries: SubjectSummary[]
  totalSpend: number
}) {
  const t = useT()
  const hasConnectorUsage = connectorAggregate.credit > 0 || connectorAggregate.eventCount > 0
  const [category, setCategory] = React.useState<UsageCategory | "all">(() => (hasConnectorUsage ? "link" : "all"))
  const [expanded, setExpanded] = React.useState(false)
  const filtered = summaries.filter((summary) => category === "all" || summary.category === category)
  const visible = expanded ? filtered : filtered.slice(0, 12)
  const hiddenCount = filtered.length - visible.length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--oo-divider)] px-3 py-2">
        <ToggleGroup
          type="single"
          value={category}
          variant="outline"
          size="sm"
          onValueChange={(value) => {
            if (value === "all" || categoryOrder.includes(value as UsageCategory)) {
              setCategory(value as UsageCategory | "all")
              setExpanded(false)
            }
          }}
        >
          <ToggleGroupItem value="all">{t("billing.breakdown.all")}</ToggleGroupItem>
          {categoryOrder.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {t(`billing.category.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="oo-text-caption">{t("billing.breakdown.items", { count: filtered.length })}</span>
      </div>
      {visible.length === 0 ? (
        category === "link" && hasConnectorUsage ? (
          <div className="grid gap-1 px-4 py-6">
            <div className="oo-text-title text-foreground">{t("billing.breakdown.connectorAggregateOnlyTitle")}</div>
            <p className="oo-text-body text-muted-foreground">
              {t("billing.breakdown.connectorAggregateOnlyDescription", {
                amount: spendAvailable ? formatCredit(connectorAggregate.credit) : "—",
                count: meteringAvailable ? Intl.NumberFormat().format(connectorAggregate.eventCount) : "—",
              })}
            </p>
          </div>
        ) : (
          <div className="oo-text-body px-4 py-8 text-center text-muted-foreground">{t("billing.breakdown.empty")}</div>
        )
      ) : (
        <div>
          <div className="oo-text-caption hidden grid-cols-[minmax(12rem,1fr)_8rem_8rem_8rem_5rem] gap-3 border-b border-[var(--oo-divider)] px-3 py-2 md:grid">
            <span>{t("billing.breakdown.subject")}</span>
            <span className="text-right">{t("billing.breakdown.calls")}</span>
            <span className="text-right">{t("billing.breakdown.usage")}</span>
            <span className="text-right">{t("billing.breakdown.spend")}</span>
            <span className="text-right">{t("billing.breakdown.share")}</span>
          </div>
          {visible.map((summary) => {
            const share = totalSpend > 0 ? (summary.credit * 100) / totalSpend : 0
            return (
              <div
                key={`${summary.source}:${summary.subject}`}
                className="grid min-h-14 gap-2 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 md:grid-cols-[minmax(12rem,1fr)_8rem_8rem_8rem_5rem] md:items-center md:gap-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {summary.category === "link" ? (
                    <ProviderIcon iconUrl={summary.iconUrl} displayName={formatSubjectLabel(summary)} />
                  ) : (
                    <div className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--oo-inspector-surface)] text-muted-foreground">
                      {categoryIcon(summary.category)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="oo-text-title truncate text-foreground" title={summary.subjects.join(", ")}>
                      {formatSubjectLabel(summary)}
                    </div>
                    {summary.category === "link" ? null : (
                      <div className="oo-text-caption flex min-w-0 items-center gap-2">
                        <Badge variant="outline">{t(`billing.category.${summary.category}`)}</Badge>
                        <span className="truncate" title={summary.source}>
                          {formatSourceLabel(summary.source, t)}
                        </span>
                        {summary.subjects.length > 1 ? (
                          <span className="shrink-0">
                            {t("billing.breakdown.subjectCount", { count: summary.subjects.length })}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
                <BreakdownMetric
                  label={t("billing.breakdown.calls")}
                  value={meteringAvailable ? Intl.NumberFormat().format(summary.eventCount) : "—"}
                />
                <BreakdownMetric
                  label={t("billing.breakdown.usage")}
                  value={meteringAvailable ? formatUsage(summary.totalUsage) : "—"}
                />
                <BreakdownMetric
                  label={t("billing.breakdown.spend")}
                  value={spendAvailable ? formatCredit(summary.credit) : "—"}
                />
                <BreakdownMetric
                  label={t("billing.breakdown.share")}
                  value={spendAvailable ? formatPercent(share) : "—"}
                />
              </div>
            )
          })}
          {filtered.length > 12 ? (
            <div className="flex items-center justify-between gap-3 bg-muted/20 px-3 py-2.5">
              <span className="oo-text-caption">
                {expanded ? t("billing.breakdown.allShown") : t("billing.breakdown.hidden", { count: hiddenCount })}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                {expanded ? t("billing.collapseBalanceLots") : t("billing.viewAllBalanceLots")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function BreakdownMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 md:block md:text-right">
      <span className="oo-text-caption md:hidden">{label}</span>
      <span className="oo-text-value truncate text-foreground tabular-nums">{value}</span>
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
          <div className="oo-text-caption flex min-w-0 items-center gap-2">
            <Badge variant="outline">{balanceScopeLabel(lot.serviceScope, t)}</Badge>
            <span className="truncate">
              {lot.expiresAt ? t("billing.expiresAt", { date: formatDate(lot.expiresAt) }) : t("billing.neverExpires")}
            </span>
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

function balanceScopeLabel(scope: string, t: ReturnType<typeof useT>): string {
  if (scope === "GENERAL") return t("billing.balanceScope.general")
  if (scope === "SERVICE_OOMOL_CONNECTOR") return t("billing.balanceScope.connector")
  return t("billing.balanceScope.other")
}

function formatSourceLabel(source: string, t: ReturnType<typeof useT>): string {
  if (source === "SERVICE_LLM") return t("billing.source.model")
  if (source === "SERVICE_FUSION_API") return t("billing.source.api")
  if (source === "SERVICE_OOMOL_CONNECTOR") return t("billing.source.connector")
  return source
}

function formatSubjectLabel(summary: SubjectSummary): string {
  return summary.displayName || summary.subject
}

function formatUsage(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

function exportUsageCsv(
  summaries: SubjectSummary[],
  connectorAggregate: CategorySummary,
  period: BillingPeriodDays,
  dataAsOf: number | undefined,
  available: { metering: boolean; spend: boolean },
): void {
  const generatedAt = new Date().toISOString()
  const appBreakdownAvailable = summaries.some((summary) => summary.category === "link")
  const header = [
    "generated_at",
    "data_as_of",
    "period_days",
    "metering_available",
    "billing_available",
    "app_breakdown_available",
    "source",
    "category",
    "app_id",
    "display_name",
    "subject",
    "raw_subjects",
    "event_count",
    "total_usage",
    "total_credit",
  ]
  const reportMeta: Array<string | number | boolean> = [
    generatedAt,
    dataAsOf ? new Date(normalizeTimestamp(dataAsOf)).toISOString() : "",
    period,
    available.metering,
    available.spend,
    appBreakdownAvailable,
  ]
  const rows: Array<Array<string | number | boolean>> = summaries.map((summary) => [
    ...reportMeta,
    summary.source,
    summary.category,
    summary.appId ?? "",
    summary.displayName ?? "",
    summary.subject,
    summary.subjects.join("|"),
    available.metering ? summary.eventCount : "",
    available.metering ? summary.totalUsage : "",
    available.spend ? summary.credit : "",
  ])
  if (rows.length === 0 && (connectorAggregate.credit > 0 || connectorAggregate.eventCount > 0)) {
    rows.push([
      ...reportMeta,
      "SERVICE_OOMOL_CONNECTOR",
      "link",
      "",
      "",
      "connector-total",
      "",
      available.metering ? connectorAggregate.eventCount : "",
      "",
      available.spend ? connectorAggregate.credit : "",
    ])
  }
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `wanta-usage-${period}d-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
