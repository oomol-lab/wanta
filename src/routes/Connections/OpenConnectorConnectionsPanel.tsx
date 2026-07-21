import type { OpenConnectorAppSummary } from "../../../electron/link-runtime/common.ts"
import type { UseLinkRuntime } from "@/hooks/useLinkRuntime"
import type { MessageKey } from "@/i18n/i18n"

import { ExternalLinkIcon, RefreshCwIcon, ServerIcon } from "lucide-react"
import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppI18n } from "@/i18n"

export function OpenConnectorConnectionsPanel({ runtime }: { runtime: UseLinkRuntime }) {
  const { t } = useAppI18n()
  const [apps, setApps] = React.useState<OpenConnectorAppSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const config = runtime.state?.openConnector
  const runtimeRef = React.useRef(runtime)
  runtimeRef.current = runtime

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setApps(await runtimeRef.current.listOpenConnectorApps())
      await runtimeRef.current.refreshStatus()
    } catch (cause) {
      console.error("[wanta] OpenConnector inventory load failed", cause)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer")

  return (
    <div className="h-full min-h-0 overflow-auto p-6">
      <div className="mx-auto grid w-full max-w-4xl gap-5">
        <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                <ServerIcon className="size-5" />
              </div>
              <div className="min-w-0">
                <h1 className="oo-text-title">{t("connections.openConnector.title")}</h1>
                <p className="oo-text-caption truncate">{config?.baseUrl}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
                <RefreshCwIcon className={loading ? "size-4 animate-spin" : "size-4"} />
                {t("connections.openConnector.refresh")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!config?.consoleUrl}
                onClick={() => config?.consoleUrl && open(config.consoleUrl)}
              >
                <ExternalLinkIcon className="size-4" />
                {t("connections.openConnector.openConsole")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={runtime.status.kind === "online" ? "success" : "secondary"}>
              {t(openConnectorStatusKey(runtime.status.kind))}
            </Badge>
            <span className="oo-text-caption">{t("connections.openConnector.readOnlyHint")}</span>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="oo-text-title">{t("connections.openConnector.connectedApps")}</h2>
          </div>
          {error ? (
            <div className="oo-text-body p-6 text-center text-destructive">
              {t("connections.openConnector.loadFailed")}
            </div>
          ) : loading ? (
            <div className="oo-text-body p-6 text-center text-muted-foreground">
              {t("connections.openConnector.loading")}
            </div>
          ) : apps.length === 0 ? (
            <div className="oo-text-body p-6 text-center text-muted-foreground">
              {t("connections.openConnector.empty")}
            </div>
          ) : (
            <div className="divide-y">
              {apps.map((app) => (
                <OpenConnectorAppRow
                  key={`${app.service}:${app.connectionName}`}
                  app={app}
                  consoleUrl={config?.consoleUrl}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function openConnectorStatusKey(kind: UseLinkRuntime["status"]["kind"]): MessageKey {
  switch (kind) {
    case "online":
      return "connections.openConnector.status.online"
    case "offline":
      return "connections.openConnector.status.offline"
    case "unauthorized":
      return "connections.openConnector.status.unauthorized"
    case "incompatible":
      return "connections.openConnector.status.incompatible"
    case "unknown":
      return "connections.openConnector.status.unknown"
  }
}

function OpenConnectorAppRow({ app, consoleUrl }: { app: OpenConnectorAppSummary; consoleUrl?: string }) {
  const { t } = useAppI18n()
  const manageUrl = consoleUrl
    ? `${consoleUrl.replace(/\/+$/, "")}/providers/${encodeURIComponent(app.service)}`
    : undefined

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="oo-text-label text-foreground">{app.displayName || app.service}</span>
          <Badge variant={app.status === "active" ? "success" : "secondary"}>
            {app.status === "active"
              ? t("connections.openConnector.active")
              : t("connections.openConnector.disconnected")}
          </Badge>
          {app.isDefault ? <Badge variant="secondary">{t("connections.defaultConnection")}</Badge> : null}
        </div>
        <p className="oo-text-caption truncate">
          {app.accountLabel || app.connectionName} · {app.authType}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!manageUrl}
        onClick={() => manageUrl && window.open(manageUrl, "_blank", "noopener,noreferrer")}
      >
        <ExternalLinkIcon className="size-4" />
        {t("connections.openConnector.manage")}
      </Button>
    </div>
  )
}
