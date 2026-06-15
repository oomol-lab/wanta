import type {
  BillingLogItem,
  BillingOverviewResult,
  BillingPeriodDays,
  BillingSpendStats,
  CreditItem,
} from "../../../electron/chat/common.ts"

import {
  ArrowLeftIcon,
  CreditCardIcon,
  ImageIcon,
  ListIcon,
  MessageCircleIcon,
  PiggyBankIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import * as React from "react"
import { CreditPurchaseModal } from "./CreditPurchaseModal.tsx"
import { useChatService } from "@/components/AppContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

type UsageCategory = "chat" | "image" | "other"

interface BillingRouteProps {
  onBack: () => void
}

interface CategorySummary {
  category: UsageCategory
  credit: number
  eventCount: number
}

const periods: BillingPeriodDays[] = [7, 30, 90]
const categoryOrder: UsageCategory[] = ["chat", "image", "other"]

export function BillingRoute({ onBack }: BillingRouteProps) {
  const t = useT()
  const chatService = useChatService()
  const [period, setPeriod] = React.useState<BillingPeriodDays>(30)
  const [data, setData] = React.useState<BillingOverviewResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)

  const refresh = React.useCallback(() => {
    setLoading(true)
    setError(null)
    chatService
      .invoke("getBillingOverview", { days: period })
      .then(setData)
      .catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : String(nextError)))
      .finally(() => setLoading(false))
  }, [chatService, period])

  React.useEffect(() => refresh(), [refresh])

  const summaries = React.useMemo(
    () => buildCategorySummaries(data?.spend, data?.metering),
    [data?.spend, data?.metering],
  )
  const totalSpend = summaries.reduce((sum, item) => sum + item.credit, 0)
  const totalEvents = Number(data?.metering?.total.eventCount ?? 0)
  const currentCredit = toNumber(data?.balance?.total.currentCredit)
  const averageDailySpend = period > 0 ? totalSpend / period : 0
  const coverageDays = averageDailySpend > 0 ? Math.floor(currentCredit / averageDailySpend) : 0
  const dailyBuckets = React.useMemo(
    () => buildDailySpendBuckets(data?.spend?.items ?? [], period),
    [data?.spend, period],
  )
  const maxDailySpend = Math.max(...dailyBuckets.map((bucket) => bucket.credit), 0)
  const recentLogs = React.useMemo(
    () => [...(data?.logs ?? [])].sort((left, right) => right.createdAt - left.createdAt).slice(0, 20),
    [data?.logs],
  )

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background">
      <main className="mx-auto grid w-full max-w-[110rem] gap-6 px-8 py-7">
        <section className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="grid gap-3">
            <Button type="button" variant="secondary" className="w-fit" onClick={onBack}>
              <ArrowLeftIcon className="size-4" />
              {t("billing.backToChat")}
            </Button>
            <p className="text-base leading-7 text-muted-foreground">{t("billing.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className="inline-flex rounded-lg border border-border bg-muted p-1"
              role="radiogroup"
              aria-label={t("billing.period")}
            >
              {periods.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={period === value}
                  className={cn(
                    "h-9 rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors",
                    period === value && "bg-background text-foreground shadow-sm",
                  )}
                  onClick={() => setPeriod(value)}
                >
                  {t(`billing.period${value}`)}
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" disabled={loading} onClick={refresh}>
              <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
              {t("billing.refresh")}
            </Button>
            <Button type="button" onClick={() => setPurchaseOpen(true)}>
              <CreditCardIcon className="size-4" />
              {t("billing.purchaseCredits")}
            </Button>
          </div>
        </section>

        {error ? (
          <div className="rounded-lg border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label={t("billing.summary")}>
          <Metric
            icon={<PiggyBankIcon className="size-4" />}
            label={t("billing.availableCredits")}
            value={loading && !data ? "..." : formatCredit(currentCredit)}
            meta={totalSpend > 0 ? t("billing.coverage", { days: coverageDays }) : t("billing.coverageStable")}
          />
          <Metric
            icon={<SparklesIcon className="size-4" />}
            label={t("billing.periodSpend")}
            value={loading && !data ? "..." : formatCredit(totalSpend)}
            meta={t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}
          />
          <Metric
            icon={<MessageCircleIcon className="size-4" />}
            label={t("billing.chatSpend")}
            value={loading && !data ? "..." : formatCredit(getSummary(summaries, "chat").credit)}
            meta={t("billing.chatSpendMeta")}
          />
          <Metric
            icon={<ListIcon className="size-4" />}
            label={t("billing.callCount")}
            value={loading && !data ? "..." : Intl.NumberFormat().format(totalEvents)}
            meta={t("billing.callCountMeta", { days: period })}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)]">
          <Panel title={t("billing.categoryTitle")} meta={t("billing.categoryMeta")}>
            {loading && !data ? (
              <LoadingRows count={3} />
            ) : (
              <CategorySpendList summaries={summaries} total={totalSpend} />
            )}
          </Panel>
          <Panel title={t("billing.balanceLotsTitle")} meta={t("billing.balanceLotsMeta")}>
            {loading && !data ? <LoadingRows count={3} /> : <BalanceLots lots={data?.balance?.items ?? []} />}
          </Panel>
        </section>

        <Panel title={t("billing.trendTitle")} meta={t("billing.trendMeta", { days: period })}>
          {loading && !data ? (
            <Skeleton className="h-44 w-full rounded-lg" />
          ) : (
            <div className="flex h-44 items-end gap-1" aria-label={t("billing.trendTitle")}>
              {dailyBuckets.map((bucket) => {
                const height = maxDailySpend > 0 ? Math.max(2, (bucket.credit / maxDailySpend) * 100) : 0
                return (
                  <div
                    key={bucket.key}
                    className="flex min-w-0 flex-1 items-end rounded-t bg-muted"
                    title={`${bucket.label}: ${formatCredit(bucket.credit)}`}
                  >
                    <div className="w-full rounded-t bg-foreground" style={{ height: `${height}%` }} />
                  </div>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title={t("billing.recordsTitle")} meta={t("billing.recordsMeta")}>
          {loading && !data ? <LoadingRows count={5} /> : <RecentRecords logs={recentLogs} />}
        </Panel>
      </main>
      <CreditPurchaseModal
        open={purchaseOpen}
        showViewDetails={false}
        onClose={() => {
          setPurchaseOpen(false)
          refresh()
        }}
      />
    </div>
  )
}

function Metric({ icon, label, meta, value }: { icon: React.ReactNode; label: string; meta: string; value: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-3xl font-semibold tracking-normal text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground">{meta}</div>
    </div>
  )
}

function Panel({ children, meta, title }: { children: React.ReactNode; meta?: string; title: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function LoadingRows({ count }: { count: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
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
            className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-4 border-b border-border py-4 last:border-b-0"
          >
            <div className="grid size-10 place-items-center rounded-lg bg-muted">{categoryIcon(category)}</div>
            <div className="grid min-w-0 gap-2">
              <div className="font-semibold text-foreground">{t(`billing.category.${category}`)}</div>
              <div className="text-sm text-muted-foreground">
                {t("billing.categoryCalls", { count: Intl.NumberFormat().format(summary.eventCount) })}
              </div>
              <Progress value={share} className="h-1.5 bg-muted" />
            </div>
            <div className="text-right">
              <div className="font-semibold text-foreground">{formatCredit(summary.credit)}</div>
              <div className="text-sm text-muted-foreground">{formatPercent(share)}</div>
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
    return <div className="py-8 text-center text-sm text-muted-foreground">{t("billing.emptyBalanceLots")}</div>
  }
  return (
    <div className="grid gap-0">
      {sortedLots.slice(0, 3).map((lot) => (
        <BalanceLotRow key={lot.id} lot={lot} />
      ))}
      {sortedLots.length > 3 ? (
        <div className="flex items-center justify-between border-t border-border pt-4 text-sm text-muted-foreground">
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
    <div className="grid gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-foreground">{balanceSourceLabel(lot.sourceType, t)}</div>
          <div className="text-sm text-muted-foreground">
            {lot.expiresAt ? t("billing.expiresAt", { date: formatDate(lot.expiresAt) }) : t("billing.neverExpires")}
          </div>
        </div>
        <div className="text-right font-semibold text-foreground">
          {formatCredit(current)}
          <div className="text-sm text-muted-foreground">{formatCredit(original)}</div>
        </div>
      </div>
      <Progress value={share} className="h-1.5 bg-muted" />
    </div>
  )
}

function RecentRecords({ logs }: { logs: BillingLogItem[] }) {
  const t = useT()
  if (logs.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{t("billing.emptyRecords")}</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 text-left font-medium">{t("billing.recordType")}</th>
            <th className="py-2 text-left font-medium">{t("billing.recordSubject")}</th>
            <th className="py-2 text-right font-medium">{t("billing.recordCost")}</th>
            <th className="py-2 text-right font-medium">{t("billing.recordTime")}</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => {
            const category = usageCategory(log.source, log.subject)
            return (
              <tr key={log.eventID} className="border-b border-border last:border-b-0">
                <td className="py-3">
                  <Badge variant={category === "other" ? "outline" : "secondary"}>
                    {t(`billing.category.${category}`)}
                  </Badge>
                </td>
                <td className="max-w-[28rem] py-3">
                  <div className="truncate text-foreground">{log.subject || log.source}</div>
                  <div className="truncate text-xs text-muted-foreground">{sourceLabel(log.source, t)}</div>
                </td>
                <td className="py-3 text-right text-foreground">{formatCredit(toNumber(log.debitCredit))}</td>
                <td className="py-3 text-right text-muted-foreground">{formatDateTime(log.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function buildCategorySummaries(
  spend: BillingSpendStats | null | undefined,
  metering: BillingSpendStats | null | undefined,
): CategorySummary[] {
  const summaries = new Map<UsageCategory, CategorySummary>()
  for (const category of categoryOrder) {
    summaries.set(category, { category, credit: 0, eventCount: 0 })
  }
  for (const item of spend?.items ?? []) {
    const summary = summaries.get(usageCategory(item.source, item.subject))
    if (summary) {
      summary.credit += toNumber(item.totalCredit)
    }
  }
  for (const item of metering?.items ?? []) {
    const summary = summaries.get(usageCategory(item.source, item.subject))
    if (summary) {
      summary.eventCount += Number(item.eventCount ?? 0)
    }
  }
  return categoryOrder.map((category) => summaries.get(category) ?? { category, credit: 0, eventCount: 0 })
}

function getSummary(summaries: CategorySummary[], category: UsageCategory): CategorySummary {
  return summaries.find((summary) => summary.category === category) ?? { category, credit: 0, eventCount: 0 }
}

function buildDailySpendBuckets(items: BillingSpendStats["items"], period: BillingPeriodDays) {
  const today = startOfDay(Date.now())
  const buckets = Array.from({ length: period }, (_, index) => {
    const time = today - (period - index - 1) * 24 * 60 * 60 * 1000
    return { key: String(time), label: formatDate(time), credit: 0 }
  })
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  for (const item of items) {
    const bucket = byKey.get(String(startOfDay(item.time)))
    if (bucket) {
      bucket.credit += toNumber(item.totalCredit)
    }
  }
  return buckets
}

function usageCategory(source: string, subject: string): UsageCategory {
  const normalizedSource = source.toLowerCase()
  const normalizedSubject = subject.toLowerCase()
  if (source === "SERVICE_LLM" || normalizedSource.includes("llm")) {
    return "chat"
  }
  if (
    normalizedSource.includes("image") ||
    /\b(image|img|picture|photo|png|jpg|jpeg|flux|banana|gpt-image|stable-diffusion)\b/.test(normalizedSubject)
  ) {
    return "image"
  }
  return "other"
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

function toNumber(value: string | number | undefined): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function formatCredit(value: number | string | undefined): string {
  const amount = toNumber(value)
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount)}`
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function startOfDay(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
