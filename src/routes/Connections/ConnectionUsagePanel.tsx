import type {
  ConnectionExecutionLogSummary,
  ConnectionProviderSummary,
  ConnectionUsageDailyPoint,
  ConnectionUsageServiceItem,
} from "../../../electron/connections/common.ts"
import type { UseConnections } from "@/hooks/useConnections"
import type { UserFacingError } from "@/lib/user-facing-error"

import { BarChart3, RefreshCw } from "lucide-react"
import * as React from "react"
import { executionLogLimit, formatDateTime, formatDuration, formatUsageDate } from "./connection-route-model.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

export function ProviderUsagePanel({
  connections,
  provider,
  usage,
  usageDays,
}: {
  connections: UseConnections
  provider: ConnectionProviderSummary
  usage?: ConnectionUsageServiceItem
  usageDays: number
}) {
  const t = useT()
  const [isUsageDialogOpen, setIsUsageDialogOpen] = React.useState(false)
  const [logs, setLogs] = React.useState<ConnectionExecutionLogSummary | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const providerUsage = usage ?? {
    calls: 0,
    errors: 0,
    recent: null,
    service: provider.service,
    success: 0,
    trend: [],
  }

  const loadLogs = React.useCallback(async () => {
    if (providerUsage.calls <= 0) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      setLogs(await connections.getExecutionLogs({ service: provider.service, limit: executionLogLimit }))
    } catch (err) {
      setError(resolveUserFacingError(err, { area: "connections" }))
    } finally {
      setLoading(false)
    }
  }, [connections, provider.service, providerUsage.calls])

  React.useEffect(() => {
    setIsUsageDialogOpen(false)
    setLogs(null)
    setError(null)
  }, [provider.service])

  React.useEffect(() => {
    if (isUsageDialogOpen && providerUsage.calls > 0 && !logs && !loading && !error) {
      void loadLogs()
    }
  }, [error, isUsageDialogOpen, loadLogs, loading, logs, providerUsage.calls])

  const usageTitle =
    providerUsage.calls > 0
      ? t("connections.usageCompactCalls", { count: providerUsage.calls })
      : t("connections.usageNoCalls")
  const usageDetail =
    providerUsage.calls <= 0
      ? t("connections.usageCompactEmpty", { days: usageDays })
      : providerUsage.errors > 0
        ? t("connections.usageCompactWithIncomplete", {
            days: usageDays,
            errors: providerUsage.errors,
            success: providerUsage.success,
          })
        : t("connections.usageCompactAllSuccess", { days: usageDays })

  return (
    <section className="grid gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
        <h3 className="oo-text-title truncate">{t("connections.usageTitle")}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          aria-label={t("connections.viewUsageForProvider", { name: provider.displayName })}
          onClick={() => setIsUsageDialogOpen(true)}
        >
          <BarChart3 className="size-3.5" />
          {t("connections.viewUsage")}
        </Button>
      </div>
      <div className="grid min-w-0 gap-2 rounded-md bg-[var(--oo-inspector-surface)] px-2.5 py-2">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <div className="oo-text-title truncate">{usageTitle}</div>
            <div className="oo-text-caption oo-text-muted truncate">{usageDetail}</div>
          </div>
        </div>
      </div>
      <UsageDialog
        open={isUsageDialogOpen}
        provider={provider}
        usage={providerUsage}
        usageDays={usageDays}
        logs={logs}
        loading={loading}
        error={error}
        onClose={() => setIsUsageDialogOpen(false)}
        onRefresh={() => void loadLogs()}
      />
    </section>
  )
}

function UsageDialog({
  open,
  provider,
  usage,
  usageDays,
  logs,
  loading,
  error,
  onClose,
  onRefresh,
}: {
  error: UserFacingError | null
  loading: boolean
  logs: ConnectionExecutionLogSummary | null
  onClose: () => void
  onRefresh: () => void
  open: boolean
  provider: ConnectionProviderSummary
  usage: ConnectionUsageServiceItem
  usageDays: number
}) {
  const t = useT()
  const successRate = usage.calls > 0 ? Math.round((usage.success / usage.calls) * 100) : 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeLabel={t("common.cancel")}
      title={t("connections.usageDialogTitle")}
      description={t("connections.usageDialogDescription", {
        days: usageDays,
        name: provider.displayName,
      })}
      className="max-w-2xl"
    >
      <div className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Badge variant="outline">{t("connections.usageRangeLabel", { days: usageDays })}</Badge>
          <Button variant="ghost" size="sm" disabled={loading || usage.calls <= 0} onClick={onRefresh}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            {t("connections.refreshExecutionLogs")}
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-2 max-[640px]:grid-cols-2">
          <Metric label={t("connections.usageCalls")} value={usage.calls} />
          <Metric label={t("connections.usageSuccess")} value={usage.success} />
          <Metric label={t("connections.usageIncomplete")} value={usage.errors} />
          <Metric label={t("connections.usageSuccessRate")} value={`${successRate}%`} />
        </div>
        <UsageTrend points={usage.trend} />
        <ExecutionLogs logs={logs} loading={loading} error={error} />
      </div>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-muted/45 px-2.5 py-2">
      <div className="oo-text-title">{value}</div>
      <div className="oo-text-caption oo-text-muted">{label}</div>
    </div>
  )
}

function UsageTrend({ points }: { points: ConnectionUsageDailyPoint[] }) {
  const t = useT()
  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date))
  const maxCalls = Math.max(1, ...sorted.map((point) => point.calls))

  if (sorted.every((point) => point.calls === 0)) {
    return (
      <div className="grid h-24 place-items-center rounded-md bg-muted/35">
        <span className="oo-text-caption oo-text-muted">{t("connections.usageDailyUnavailable")}</span>
      </div>
    )
  }

  return (
    <div className="grid h-28 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-2 rounded-md bg-muted/35 px-3 py-3">
      <div className="flex min-w-0 items-end gap-1.5">
        {sorted.map((point) => {
          const height = point.calls > 0 ? Math.max(8, Math.round((point.calls / maxCalls) * 100)) : 2
          return (
            <div
              key={point.date}
              className="flex h-full min-w-0 flex-1 items-end"
              title={`${point.date}: ${point.calls}`}
            >
              <div
                className={cn("w-full rounded-t-sm bg-muted-foreground/45", point.errors > 0 && "bg-destructive/70")}
                style={{ height: `${height}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="grid auto-cols-fr grid-flow-col gap-1.5">
        {sorted.map((point) => (
          <span key={point.date} className="oo-text-micro oo-text-muted truncate text-center">
            {formatUsageDate(point.date)}
          </span>
        ))}
      </div>
    </div>
  )
}

function ExecutionLogs({
  logs,
  loading,
  error,
}: {
  logs: ConnectionExecutionLogSummary | null
  loading: boolean
  error: UserFacingError | null
}) {
  const t = useT()
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <BarChart3 className="oo-icon-muted size-4" />
        <h4 className="oo-text-label">{t("connections.executionLogsTitle")}</h4>
      </div>
      {loading ? (
        <div className="grid gap-1">
          <div className="h-9 animate-pulse rounded-md bg-muted" />
          <div className="h-9 animate-pulse rounded-md bg-muted" />
          <div className="h-9 animate-pulse rounded-md bg-muted" />
        </div>
      ) : error ? (
        <ErrorNotice error={error} compact />
      ) : !logs || logs.items.length === 0 ? (
        <div className="oo-text-caption oo-text-muted rounded-md bg-muted/35 px-3 py-2">{t("connections.noData")}</div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          {logs.items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b px-2.5 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="oo-text-control truncate font-mono">{item.action}</div>
                <div className="oo-text-micro oo-text-muted truncate">
                  {formatDateTime(item.finishedAt, t)} · {formatDuration(item.durationMs, t)}
                </div>
              </div>
              <Badge variant={item.status === "success" ? "success" : "warning"}>
                {item.status === "success"
                  ? t("connections.executionStatusSuccess")
                  : t("connections.executionStatusError")}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
