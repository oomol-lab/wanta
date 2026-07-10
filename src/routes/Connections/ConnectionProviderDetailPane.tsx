import type {
  ConnectionAuthType,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionSummary,
} from "../../../electron/connections/common.ts"
import type { ConnectionErrorNotice } from "./connection-error-display.ts"
import type { DisconnectTarget } from "./connection-route-model.ts"
import type { UseConnections } from "@/hooks/useConnections"

import { AlertCircle, ExternalLink, KeyRound, Plug, X } from "lucide-react"
import * as React from "react"
import {
  authTypeNeedsDialog,
  formatAuthTypes,
  formatDateTime,
  formatProviderCategoryLabels,
  getDefaultAuthType,
  getProviderAccountValue,
  getEmptyState,
  getProviderDescription,
  getProviderStatusDisplayLabel,
  getProviderStatusTone,
  isConnected,
  isNoAuthReadyProvider,
} from "./connection-route-model.ts"
import { AuthTypeToggleGroup, ConnectionAccountsList } from "./ConnectionAccountsList.tsx"
import { ProviderUsagePanel } from "./ConnectionUsagePanel.tsx"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { Loader } from "@/components/ai-elements/loader"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { isConnectionServicePollingTarget } from "@/hooks/connection-oauth-pending"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export interface ConnectionAuthIntent {
  action?: string
  createdAt: number
  displayName?: string
  errorCode?: string
  id: string
  message?: string
  service: string
  source: "chat"
}

function ProviderStatusBadge({ provider }: { provider: ConnectionProviderSummary }) {
  const t = useT()
  const tone = getProviderStatusTone(provider)
  return (
    <Badge variant={tone === "connected" ? "success" : tone === "attention" ? "warning" : "muted"}>
      {getProviderStatusDisplayLabel(provider, t)}
    </Badge>
  )
}

export function StatusNotice({ summary }: { summary: ConnectionSummary }) {
  const t = useT()
  const state = getEmptyState(summary, t)
  return (
    <section className="grid gap-1 rounded-lg border border-dashed px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <AlertCircle className="oo-icon-muted size-4" />
        <div className="oo-text-label truncate">{state.title}</div>
      </div>
      <div className="oo-text-caption oo-text-muted">{summary.message || state.description}</div>
    </section>
  )
}

export function EmptyList({ summary, hasQuery }: { summary: ConnectionSummary | null; hasQuery: boolean }) {
  const t = useT()
  const state = getEmptyState(summary, t)
  return (
    <section className="grid gap-1 rounded-lg border bg-muted/30 px-3 py-3">
      <div className="oo-text-label">{hasQuery ? t("connections.emptySearch") : state.title}</div>
      <div className="oo-text-caption oo-text-muted">{hasQuery ? t("connections.noMatch") : state.description}</div>
    </section>
  )
}

export function ProviderDetail({
  actionsBlocked,
  actionsPending,
  authIntent,
  busy,
  detail,
  errorNotice,
  detailLoading,
  connections,
  onCancelPolling,
  onClose,
  onConnect,
  onDisconnect,
  polling,
  provider,
  showCloseButton = false,
  summary,
}: {
  actionsBlocked?: boolean
  actionsPending?: boolean
  authIntent?: ConnectionAuthIntent | null
  busy: UseConnections["busy"]
  connections: UseConnections
  detail: ConnectionProviderDetail | null
  errorNotice: ConnectionErrorNotice | null
  detailLoading: boolean
  onCancelPolling: () => void
  onClose: () => void
  onConnect: (
    provider: ConnectionProviderSummary,
    authType: Exclude<ConnectionAuthType, null>,
    appId?: string,
  ) => Promise<void>
  onDisconnect: (target: DisconnectTarget) => void
  polling: string | null
  provider: ConnectionProviderSummary
  showCloseButton?: boolean
  summary: ConnectionSummary | null
}) {
  const t = useT()
  const currentAuthType = getDefaultAuthType(provider)
  const usage = summary?.usage.services.find((item) => item.service === provider.service)
  const accountValue = getProviderAccountValue(provider, t)
  const noAuthReady = isNoAuthReadyProvider(provider)

  return (
    <div className="grid min-w-0 gap-3">
      {summary && summary.status !== "ready" ? <StatusNotice summary={summary} /> : null}

      <section className="grid gap-3 border-b pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="oo-text-title truncate">{provider.displayName}</h2>
              <ProviderStatusBadge provider={provider} />
            </div>
            <p className="oo-text-caption oo-text-muted mt-1 break-words">{getProviderDescription(provider, t)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {detail?.homepageUrl ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={t("connections.homepage")}
                onClick={() => void connections.openExternal(detail.homepageUrl as string)}
              >
                <ExternalLink className="size-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8", !showCloseButton && "hidden min-[960px]:inline-flex")}
              aria-label={t("connections.closeProviderDetails")}
              title={t("connections.closeProviderDetails")}
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        {errorNotice ? (
          <ErrorNotice error={errorNotice.error} compact showDiagnosticsCopy={errorNotice.showDiagnosticsCopy} />
        ) : null}
        {authIntent ? <ConnectionAuthIntentNotice authIntent={authIntent} provider={provider} /> : null}
        {actionsBlocked ? null : (
          <ConnectionPanel
            authIntent={authIntent}
            busy={busy}
            canSetDefault={summary?.workspace.type !== "organization"}
            connections={connections}
            currentAuthType={currentAuthType}
            actionsPending={actionsPending}
            detail={detail}
            detailLoading={detailLoading}
            onCancelPolling={onCancelPolling}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            polling={polling}
            provider={provider}
          />
        )}
      </section>

      {isConnected(provider) ? (
        <ProviderUsagePanel
          connections={connections}
          provider={provider}
          usage={usage}
          usageDays={summary?.usage.days ?? 7}
          usageLoading={Boolean(summary?.usageLoading)}
        />
      ) : null}

      <section className="grid gap-1.5">
        <h3 className="oo-text-title px-0.5">{t("connections.providerDetails")}</h3>
        <dl className="overflow-hidden rounded-md border">
          {noAuthReady ? null : <DetailRow label={t("connections.account")} value={accountValue} />}
          {noAuthReady ? null : (
            <DetailRow label={t("connections.auth")} value={formatAuthTypes(provider.authTypes, t)} />
          )}
          <DetailRow label={t("connections.category")} value={formatProviderCategoryLabels(provider, t)} />
          <DetailRow label={t("connections.service")} value={provider.service} mono />
          {noAuthReady ? null : (
            <DetailRow label={t("connections.updatedAt")} value={formatDateTime(provider.connectedUpdatedAt, t)} />
          )}
        </dl>
      </section>
    </div>
  )
}

function ConnectionAuthIntentNotice({
  authIntent,
  provider,
}: {
  authIntent: ConnectionAuthIntent
  provider: ConnectionProviderSummary
}) {
  const t = useT()
  return (
    <div className="grid gap-1 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <AlertCircle className="size-4 shrink-0 text-[var(--oo-warning-foreground)]" />
        <span className="oo-text-title min-w-0 truncate">
          {t("connections.chatAuthRequestTitle", { name: provider.displayName })}
        </span>
      </div>
      <div className="oo-text-caption text-muted-foreground">
        {authIntent.action
          ? t("connections.chatAuthRequestActionDescription", { action: authIntent.action })
          : t("connections.chatAuthRequestDescription")}
      </div>
      {authIntent.errorCode ? <div className="oo-text-micro text-muted-foreground">{authIntent.errorCode}</div> : null}
    </div>
  )
}

function ConnectionPanel({
  actionsPending,
  authIntent,
  busy,
  canSetDefault,
  connections,
  currentAuthType,
  detail,
  detailLoading,
  onCancelPolling,
  onConnect,
  onDisconnect,
  polling,
  provider,
}: {
  actionsPending?: boolean
  authIntent?: ConnectionAuthIntent | null
  busy: UseConnections["busy"]
  canSetDefault: boolean
  connections: UseConnections
  currentAuthType: Exclude<ConnectionAuthType, null> | null
  detail: ConnectionProviderDetail | null
  detailLoading: boolean
  onCancelPolling: () => void
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
  const [selectedAuthType, setSelectedAuthType] = React.useState<Exclude<ConnectionAuthType, null> | null>(
    currentAuthType,
  )
  const authTypes = detail?.authTypes.length ? detail.authTypes : provider.authTypes
  const usableAuthTypes = authTypes.length > 0 ? authTypes : currentAuthType ? [currentAuthType] : []
  const activeAuthType =
    selectedAuthType && usableAuthTypes.includes(selectedAuthType) ? selectedAuthType : usableAuthTypes[0]
  const isPolling = isConnectionServicePollingTarget(polling, provider.service)
  const authorizationBlocked = polling !== null && !isPolling
  const noAuthReady = isNoAuthReadyProvider(provider)

  React.useEffect(() => {
    setSelectedAuthType(currentAuthType)
  }, [currentAuthType, provider.service])

  return (
    <div className="grid gap-2.5 border-t pt-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="oo-text-title truncate">
            {provider.status === "connected" && provider.apps.length > 1
              ? t("connections.connectedConnections")
              : isConnected(provider)
                ? t("connections.connectedConnection")
                : t("connections.connectProvider")}
          </h3>
          {detailLoading ? <Loader className="oo-icon-muted shrink-0" size={16} /> : null}
        </div>
        {actionsPending || noAuthReady ? null : (
          <AuthTypeToggleGroup
            authTypes={usableAuthTypes}
            value={activeAuthType ?? null}
            onChange={setSelectedAuthType}
          />
        )}
      </div>

      {actionsPending ? null : noAuthReady ? (
        <div className="oo-text-caption oo-text-muted rounded-md border bg-muted/30 px-3 py-2">
          {t("connections.noAuthReadyDescription")}
        </div>
      ) : activeAuthType ? (
        <div className="flex flex-wrap items-center gap-2">
          {isPolling ? (
            <>
              <Button size="sm" disabled className="gap-1.5">
                <Loader size={16} />
                {t("connections.oauthWaiting")}
              </Button>
              <Button size="sm" variant="outline" onClick={onCancelPolling}>
                {t("common.cancel")}
              </Button>
            </>
          ) : authorizationBlocked ? (
            <>
              <Button size="sm" disabled className="gap-1.5">
                <Loader size={16} />
                {t("connections.oauthInProgress")}
              </Button>
              <Button size="sm" variant="outline" onClick={onCancelPolling}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy === "connect"}
              className="gap-1.5"
              onClick={() => void onConnect(provider, activeAuthType)}
            >
              {busy === "connect" ? (
                <Loader size={16} />
              ) : authTypeNeedsDialog(activeAuthType) ? (
                <KeyRound className="size-4" />
              ) : (
                <Plug className="size-4" />
              )}
              {authIntent
                ? t("connections.connectAndContinue")
                : provider.apps.length > 0
                  ? t("connections.addConnection")
                  : t("connections.connectProvider")}
            </Button>
          )}
        </div>
      ) : (
        <div className="oo-text-caption oo-text-muted">{t("connections.unsupportedConnectionDescription")}</div>
      )}

      {!actionsPending && provider.apps.length > 0 ? (
        <ConnectionAccountsList
          busy={busy}
          canSetDefault={canSetDefault}
          connections={connections}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          polling={polling}
          provider={provider}
          reconnectBlocked={authorizationBlocked}
        />
      ) : null}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] border-b px-2.5 py-1.5 last:border-b-0">
      <dt className="oo-text-caption oo-text-muted">{label}</dt>
      <dd className={cn("oo-text-control min-w-0 truncate", mono && "font-mono")}>{value}</dd>
    </div>
  )
}
