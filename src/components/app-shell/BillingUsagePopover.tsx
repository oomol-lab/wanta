import { ArrowRightIcon, GaugeIcon, LogInIcon, RefreshCwIcon, WalletCardsIcon, XIcon } from "lucide-react"
import * as React from "react"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import {
  buildCategorySummaries,
  formatCredit,
  getSummary,
  statsTotalCredit,
  statsTotalEvents,
  toNumber,
} from "@/routes/Billing/usage.ts"

const usagePeriodDays = 30
const cacheFreshMs = 60_000

interface BillingUsagePopoverProps {
  cacheScope: string
  onViewDetails: () => void
}

export function BillingUsagePopover({ cacheScope, onViewDetails }: BillingUsagePopoverProps) {
  const t = useT()
  const { login } = useAuth()
  const [open, setOpen] = React.useState(false)
  const { data, error, loading, refresh } = useBillingOverview(usagePeriodDays, {
    cacheScope,
    enabled: open,
    summaryOnly: true,
    staleMs: cacheFreshMs,
  })
  // 会话过期（计费用的 oomol-token 失效，agent 仍可用）：重新登录刷新会话，而非误导用户去充值。
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
  const averageDailySpend = totalSpend / usagePeriodDays
  const coverageDays = averageDailySpend > 0 ? Math.floor(currentCredit / averageDailySpend) : 0
  const chatSpend = getSummary(summaries, "chat").credit
  const sourceCount = data?.balance?.items.length ?? 0
  const availableSourceCount =
    data?.balance?.items.filter((item) => item.available && toNumber(item.currentCredit) > 0).length ?? 0
  const availableShare =
    originalCredit > 0
      ? Math.max(0, Math.min(100, (currentCredit / originalCredit) * 100))
      : currentCredit > 0
        ? 100
        : 0
  // 仅在真正拿到余额（无错误）且为 0 时才提示耗尽；会话过期/读取失败一律不显示破坏性"余额耗尽"。
  const hasNoCredits = Boolean(data && currentCredit <= 0 && !error)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent>{t("billing.popover.tooltip")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={8} className="w-[23rem] overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold text-foreground">
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
          {loading && !data ? (
            <BillingUsageSkeleton />
          ) : error ? (
            <ErrorNotice
              error={error}
              compact
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
          ) : (
            <>
              <section className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">{t("billing.availableCredits")}</div>
                    <div className="mt-1 text-3xl font-semibold tracking-normal text-foreground">
                      {formatCredit(currentCredit)}
                    </div>
                  </div>
                  <div className="pt-5 text-right text-sm text-muted-foreground">
                    {averageDailySpend > 0
                      ? t("billing.popover.coverageDays", { days: coverageDays })
                      : t("billing.coverageStable")}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Progress value={availableShare} className="h-1.5 bg-muted" />
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{t("billing.popover.periodSpend", { amount: formatCredit(totalSpend) })}</span>
                    <span>{t("billing.averageDaily", { amount: formatCredit(averageDailySpend) })}</span>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <UsageMiniMetric label={t("billing.chatSpend")} value={formatCredit(chatSpend)} />
                <UsageMiniMetric label={t("billing.callCount")} value={Intl.NumberFormat().format(totalEvents)} />
              </section>

              <section className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{t("billing.balanceLotsTitle")}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("billing.popover.creditSources", { count: sourceCount })}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold text-foreground">
                    {t("billing.popover.availableSources", { count: availableSourceCount })}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={loading}
            onClick={() => void refresh({ force: true })}
          >
            <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
            <span className="sr-only">{t("billing.refresh")}</span>
          </Button>
          <Button
            type="button"
            className="min-w-0 flex-1"
            onClick={() => {
              setOpen(false)
              onViewDetails()
            }}
          >
            {t(hasNoCredits ? "billing.purchaseCredits" : "billing.popover.viewDetails")}
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function BillingUsageSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-2 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
      <Skeleton className="h-16 rounded-lg" />
    </div>
  )
}

function UsageMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="truncate text-lg font-semibold tracking-normal text-foreground">{value}</div>
    </div>
  )
}
