import type { ConnectionAuthType, ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { DisconnectTarget } from "./connection-route-model.ts"
import type { UseConnections } from "@/hooks/useConnections"

import { KeyRound, Star, Unplug } from "lucide-react"
import {
  accountActionButtonClassName,
  getConnectionAppDisplayLabel,
  isConnectionAuthType,
} from "./connection-route-model.ts"
import { authTypeLabel } from "./shared.ts"
import { Loader } from "@/components/ai-elements/loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isConnectionPollingTarget } from "@/hooks/connection-oauth-pending"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function ConnectionAccountsList({
  busy,
  canSetDefault,
  connections,
  onConnect,
  onDisconnect,
  polling,
  provider,
}: {
  busy: UseConnections["busy"]
  canSetDefault: boolean
  connections: UseConnections
  onConnect: (
    provider: ConnectionProviderSummary,
    authType: Exclude<ConnectionAuthType, null>,
    appId?: string,
  ) => Promise<void>
  onDisconnect: (target: DisconnectTarget) => void
  polling: string | null
  provider: ConnectionProviderSummary
}) {
  const t = useT()
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
        <h4 className="oo-text-caption font-medium text-foreground">{t("connections.connectionAccounts")}</h4>
        <span className="oo-text-micro oo-text-muted shrink-0">
          {t("connections.connectionCount", { count: provider.apps.length })}
        </span>
      </div>
      {provider.apps.map((app, index) => {
        const isPolling = isConnectionPollingTarget(polling, provider.service, app.id)
        const reconnectAuthType =
          app.authType && app.authType !== "no_auth" && isConnectionAuthType(app.authType, provider.authTypes)
            ? app.authType
            : null
        const authLabel = app.authType ? authTypeLabel(t, app.authType) : t("connections.authUnknown")
        const accountLabel = getConnectionAppDisplayLabel(app, index, t)
        return (
          <article
            key={app.id}
            className="grid min-w-0 gap-2.5 rounded-md border bg-card px-3 py-2.5 text-card-foreground"
          >
            <div className="grid min-w-0 gap-1">
              <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                <span className="oo-text-control max-w-full min-w-0 font-medium break-all">{accountLabel}</span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {app.isDefault ? <Badge variant="success">{t("connections.defaultConnection")}</Badge> : null}
                  {app.status === "reauth_required" || app.status === "error" ? (
                    <Badge variant="warning">{t("connections.providerNeedsAttention")}</Badge>
                  ) : null}
                </span>
              </div>
              <div className="oo-text-micro oo-text-muted flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="shrink-0">{authLabel}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t pt-2">
              {canSetDefault && !app.isDefault && provider.apps.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={accountActionButtonClassName}
                  onClick={() => void connections.setDefaultAccount(provider.service, app.id)}
                >
                  <Star className="size-3.5" />
                  {t("connections.setDefaultConnection")}
                </Button>
              ) : null}
              {reconnectAuthType ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={accountActionButtonClassName}
                  disabled={isPolling || busy === "connect"}
                  onClick={() => void onConnect(provider, reconnectAuthType, app.id)}
                >
                  {isPolling ? <Loader size={14} /> : <KeyRound className="size-3.5" />}
                  {isPolling ? t("connections.oauthWaiting") : t("connections.reconnect")}
                </Button>
              ) : null}
              {provider.canDisconnect ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy === "disconnect"}
                  className={cn(
                    accountActionButtonClassName,
                    "border-[var(--oo-danger-border)] text-destructive hover:bg-[var(--oo-danger-surface)] hover:text-destructive",
                  )}
                  onClick={() => onDisconnect({ provider, app })}
                >
                  <Unplug className="size-3.5" />
                  {t("connections.disconnect")}
                </Button>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export function AuthTypeToggleGroup({
  authTypes,
  onChange,
  value,
}: {
  authTypes: Exclude<ConnectionAuthType, null>[]
  onChange: (value: Exclude<ConnectionAuthType, null>) => void
  value: Exclude<ConnectionAuthType, null> | null
}) {
  const t = useT()

  if (authTypes.length <= 1) {
    return null
  }

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      type="single"
      value={value ?? undefined}
      aria-label={t("connections.authMode")}
      onValueChange={(nextValue) => {
        if (isConnectionAuthType(nextValue, authTypes)) {
          onChange(nextValue)
        }
      }}
    >
      {authTypes.map((authType) => (
        <ToggleGroupItem key={authType} value={authType}>
          {authTypeLabel(t, authType)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
