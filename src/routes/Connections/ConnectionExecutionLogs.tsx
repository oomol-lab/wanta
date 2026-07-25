import type { ConnectionExecutionLogSummary } from "../../../electron/connections/common.ts"
import type { UseConnections } from "@/hooks/useConnections"
import type { UserFacingError } from "@/lib/user-facing-error"

import { BarChart3, RefreshCw } from "lucide-react"
import * as React from "react"
import { executionLogLimit, formatDateTime, formatDuration } from "./connection-route-model.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

export function AccountExecutionLogsButton({
  appId,
  connections,
  name,
}: {
  appId: string
  connections: UseConnections
  name: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [logs, setLogs] = React.useState<ConnectionExecutionLogSummary | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const requestIdRef = React.useRef(0)

  const loadLogs = React.useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const nextLogs = await connections.getExecutionLogs({ appId, limit: executionLogLimit })
      if (requestIdRef.current === requestId) {
        setLogs(nextLogs)
      }
    } catch (cause) {
      if (requestIdRef.current === requestId) {
        setError(resolveUserFacingError(cause, { area: "connections" }))
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [appId, connections])

  React.useEffect(() => {
    requestIdRef.current += 1
    setLogs(null)
    setError(null)
    setLoading(false)
  }, [appId])

  React.useEffect(() => {
    if (open && !logs && !loading && !error) {
      void loadLogs()
    }
  }, [error, loadLogs, loading, logs, open])

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BarChart3 className="size-3.5" />
        {t("connections.viewExecutionLogs")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.cancel")}
        title={t("connections.executionLogsTitle")}
        description={t("connections.executionLogsDescription", { name })}
        className="max-w-2xl"
      >
        <div className="grid gap-3">
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => void loadLogs()}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              {t("connections.refreshExecutionLogs")}
            </Button>
          </div>
          <ExecutionLogs error={error} loading={loading} logs={logs} />
        </div>
      </Dialog>
    </>
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
  if (loading) {
    return (
      <div className="grid gap-1">
        <div className="h-9 animate-pulse rounded-md bg-muted" />
        <div className="h-9 animate-pulse rounded-md bg-muted" />
        <div className="h-9 animate-pulse rounded-md bg-muted" />
      </div>
    )
  }
  if (error) {
    return <ErrorNotice error={error} compact />
  }
  if (!logs || logs.items.length === 0) {
    return (
      <div className="oo-text-caption oo-text-muted rounded-md bg-muted/35 px-3 py-2">
        {t("connections.accountExecutionLogsEmpty")}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border">
      {logs.items.map((item) => (
        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b px-2.5 py-2 last:border-b-0">
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
  )
}
