import type {
  ConnectionAppSummary,
  ConnectionAuthType,
  ConnectionProviderSummary,
} from "../../../electron/connections/common.ts"
import type { DisconnectTarget } from "./connection-route-model.ts"
import type { ConnectionAccessContext } from "./ConnectionAccessDialog.tsx"
import type { UseConnections } from "@/hooks/useConnections"

import { Edit, KeyRound, Save, ShieldCheck, Unplug, X } from "lucide-react"
import * as React from "react"
import {
  accountActionButtonClassName,
  getConnectionAppDisplayLabel,
  isConnectionAuthType,
  normalizeConnectionAliasInput,
  supportsManagedConnectionAccountActions,
} from "./connection-route-model.ts"
import { AccountExecutionLogsButton } from "./ConnectionExecutionLogs.tsx"
import { authTypeLabel } from "./shared.ts"
import { Loader } from "@/components/ai-elements/loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isConnectionPollingTarget, isConnectionServicePollingTarget } from "@/hooks/connection-oauth-pending"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function ConnectionAccountsList({
  busy,
  accessContext,
  canManageConnections,
  connections,
  onConnect,
  onDisconnect,
  onOpenAccess,
  polling,
  provider,
  reconnectBlocked,
}: {
  accessContext?: ConnectionAccessContext
  busy: UseConnections["busy"]
  canManageConnections: boolean
  connections: UseConnections
  onConnect: (
    provider: ConnectionProviderSummary,
    authType: Exclude<ConnectionAuthType, null>,
    appId?: string,
  ) => Promise<void>
  onDisconnect: (target: DisconnectTarget) => void
  onOpenAccess: (app: ConnectionAppSummary) => void
  polling: string | null
  provider: ConnectionProviderSummary
  reconnectBlocked?: boolean
}) {
  const t = useT()
  const servicePolling = isConnectionServicePollingTarget(polling, provider.service)
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
        <h4 className="oo-text-caption font-medium text-foreground">{t("connections.connectionAccounts")}</h4>
        <span className="oo-text-micro oo-text-muted shrink-0">
          {t("connections.connectionCount", { count: provider.apps.length })}
        </span>
      </div>
      {provider.apps.map((app, index) => (
        <ConnectionAccountItem
          key={app.id}
          app={app}
          accessContext={accessContext}
          busy={busy}
          canManageConnections={canManageConnections}
          connections={connections}
          index={index}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onOpenAccess={onOpenAccess}
          polling={polling}
          provider={provider}
          reconnectBlocked={Boolean(reconnectBlocked)}
          servicePolling={servicePolling}
        />
      ))}
    </div>
  )
}

function ConnectionAccountItem({
  app,
  accessContext,
  busy,
  canManageConnections,
  connections,
  index,
  onConnect,
  onDisconnect,
  onOpenAccess,
  polling,
  provider,
  reconnectBlocked,
  servicePolling,
}: {
  app: ConnectionAppSummary
  accessContext?: ConnectionAccessContext
  busy: UseConnections["busy"]
  canManageConnections: boolean
  connections: UseConnections
  index: number
  onConnect: (
    provider: ConnectionProviderSummary,
    authType: Exclude<ConnectionAuthType, null>,
    appId?: string,
  ) => Promise<void>
  onDisconnect: (target: DisconnectTarget) => void
  onOpenAccess: (app: ConnectionAppSummary) => void
  polling: string | null
  provider: ConnectionProviderSummary
  reconnectBlocked: boolean
  servicePolling: boolean
}) {
  const t = useT()
  const supportsManagedAccount = supportsManagedConnectionAccountActions(provider)
  const managedAccountActions = canManageConnections && supportsManagedAccount
  const [aliasDraft, setAliasDraft] = React.useState(app.alias ?? "")
  const [aliasEditing, setAliasEditing] = React.useState(false)
  const [aliasBusy, setAliasBusy] = React.useState(false)
  const reconnectAuthType =
    (provider.executionMode !== "direct" || provider.canReconnect === true) &&
    app.authType &&
    app.authType !== "no_auth" &&
    isConnectionAuthType(app.authType, provider.authTypes)
      ? app.authType
      : null
  const authLabel =
    provider.connectionMethodLabel ?? (app.authType ? authTypeLabel(t, app.authType) : t("connections.authUnknown"))
  const accountLabel = getConnectionAppDisplayLabel(app, index, t)
  const connectedAccount = app.accountLabel?.trim() || app.providerAccountId?.trim() || ""
  const aliasValue = aliasDraft.trim()
  const aliasDirty = aliasValue !== (app.alias?.trim() ?? "")
  const aliasDisabled = servicePolling || aliasBusy
  const accountPolling = isConnectionPollingTarget(polling, provider.service, app.id)
  const reconnectDisabled = accountPolling || servicePolling || reconnectBlocked || busy === "connect"
  const secondaryItems = [
    connectedAccount && connectedAccount !== accountLabel ? connectedAccount : null,
    authLabel,
  ].filter((item): item is string => Boolean(item))

  React.useEffect(() => {
    setAliasDraft(app.alias ?? "")
    setAliasEditing(false)
    setAliasBusy(false)
  }, [app.id, app.alias, app.isDefault])

  async function saveAlias() {
    if (!aliasDirty || aliasDisabled) return
    setAliasBusy(true)
    try {
      const updated = await connections.updateAlias(app.id, aliasValue)
      if (updated) {
        setAliasEditing(false)
      }
    } finally {
      setAliasBusy(false)
    }
  }

  function cancelAliasEditing() {
    setAliasDraft(app.alias ?? "")
    setAliasEditing(false)
  }

  return (
    <>
      <article className="grid min-w-0 gap-2.5 rounded-md border bg-card px-3 py-2.5 text-card-foreground">
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-start gap-1.5">
            {aliasEditing && managedAccountActions ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveAlias()
                }}
              >
                <Input
                  aria-label={t("connections.alias")}
                  autoFocus
                  className="h-7 min-w-32 flex-1"
                  disabled={aliasDisabled}
                  value={aliasDraft}
                  placeholder={t("connections.aliasPlaceholder")}
                  onChange={(event) => setAliasDraft(normalizeConnectionAliasInput(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault()
                      cancelAliasEditing()
                    }
                  }}
                />
                <Button
                  type="submit"
                  variant={aliasDirty ? "default" : "ghost"}
                  size="icon"
                  className="size-7"
                  aria-label={t("connections.saveAlias")}
                  title={t("connections.saveAlias")}
                  disabled={!aliasDirty || aliasDisabled}
                >
                  {aliasBusy ? <Loader size={14} /> : <Save className="size-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("common.cancel")}
                  title={t("common.cancel")}
                  disabled={aliasBusy}
                  onClick={cancelAliasEditing}
                >
                  <X className="size-3.5" />
                </Button>
              </form>
            ) : (
              <>
                <span className="oo-text-control max-w-full min-w-0 font-medium break-all">{accountLabel}</span>
                {managedAccountActions ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("connections.editAlias")}
                    title={t("connections.editAlias")}
                    disabled={servicePolling}
                    onClick={() => setAliasEditing(true)}
                  >
                    <Edit className="size-3.5" />
                  </Button>
                ) : null}
              </>
            )}
            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              {app.isDefault ? <Badge variant="success">{t("connections.defaultConnection")}</Badge> : null}
              {app.status === "reauth_required" || app.status === "error" ? (
                <Badge variant="warning">{t("connections.providerNeedsAttention")}</Badge>
              ) : null}
            </span>
          </div>
          <div className="oo-text-micro oo-text-muted flex min-w-0 flex-wrap items-center gap-1.5">
            {secondaryItems.map((item, itemIndex) => (
              <span key={`${itemIndex}-${item}`} className="min-w-0 truncate">
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t pt-2">
          {supportsManagedAccount && accessContext ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={accountActionButtonClassName}
              onClick={() => onOpenAccess(app)}
            >
              <ShieldCheck className="size-3.5" />
              {t(canManageConnections ? "connections.manageAccess" : "connections.viewAccess")}
            </Button>
          ) : null}
          {managedAccountActions ? (
            <AccountExecutionLogsButton appId={app.id} connections={connections} name={accountLabel} />
          ) : null}
          {reconnectAuthType ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={accountActionButtonClassName}
              disabled={reconnectDisabled}
              onClick={() => void onConnect(provider, reconnectAuthType, app.id)}
            >
              {accountPolling || reconnectBlocked ? <Loader size={14} /> : <KeyRound className="size-3.5" />}
              {accountPolling
                ? t("connections.oauthWaiting")
                : reconnectBlocked
                  ? t("connections.oauthInProgress")
                  : t("connections.reconnect")}
            </Button>
          ) : null}
          {canManageConnections && provider.canDisconnect ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={servicePolling || busy === "disconnect"}
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
    </>
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
