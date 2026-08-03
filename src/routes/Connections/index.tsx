import type {
  ConnectionAuthType,
  ConnectionAppDetail,
  ConnectionConnectInput,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionUserOAuthClientConfigSummary,
} from "../../../electron/connections/common.ts"
import type { ConnectionAuthIntent, ConnectionCatalogFilter, DisconnectTarget } from "./connection-route-model.ts"
import type { UseConnections } from "@/hooks/useConnections"

import { ArrowLeft, X } from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { getConnectionDetailErrorNotice, getConnectionListErrorNotice } from "./connection-error-display.ts"
import { compareConnectionProvidersByRecommendation } from "./connection-provider-ranking.ts"
import {
  buildCategoryFilters,
  canMutateConnections,
  detailPaneAnimationMs,
  isConnected,
  isDirectlyAvailableProvider,
  matchesProviderFilter,
  matchesProviderQuery,
  shouldShowConnectionState,
} from "./connection-route-model.ts"
import {
  ConnectionDrawerSkeleton,
  ConnectionListToolbar,
  ProviderCatalog,
  ProviderListSkeleton,
} from "./ConnectionCatalog.tsx"
import { ConnectionStateNotice, EmptyList, ProviderDetail } from "./ConnectionProviderDetailPane.tsx"
import { DisconnectDialog } from "./DisconnectDialog.tsx"
import { shouldOpenOAuthClientDialog } from "./oauth-client-config.ts"
import { useConnectionProviderDetail } from "./use-connection-provider-detail.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import {
  SplitViewBody,
  SplitViewDesktopDetailPane,
  SplitViewHeader,
  SplitViewListPane,
  SplitViewMobileDetailPane,
  SplitViewRoot,
} from "@/components/ui/split-view"
import { isConnectionServicePollingTarget } from "@/hooks/connection-oauth-pending"
import { larkCliProviderDetail, larkCliProviderFromState, useLarkCliConnection } from "@/hooks/useLarkCliConnection"
import {
  useWecomCliConnection,
  wecomCliProviderDetail,
  wecomCliProviderFromState,
  wecomCliService,
} from "@/hooks/useWecomCliConnection"
import { useT } from "@/i18n/i18n"
import { getOAuthClientConfig } from "@/lib/connections-client"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

export type { ConnectionAuthIntent } from "./connection-route-model.ts"

interface ConnectionsPanelProps {
  authIntent?: ConnectionAuthIntent | null
  canManageConnections: boolean
  connections: UseConnections
  onClose?: () => void
  onConnectionReady?: (target: { service: string; connectionName?: string }) => void
  presentation?: "drawer" | "page"
  requestedFilter?: ConnectionCatalogFilter
  selectedService?: string | null
}

export function ConnectionsPanel({
  authIntent,
  canManageConnections,
  connections,
  onClose,
  onConnectionReady,
  presentation = "page",
  requestedFilter,
  selectedService,
}: ConnectionsPanelProps) {
  const t = useT()
  const {
    actionError,
    busy,
    cancelPolling,
    clearActionError,
    connect,
    disconnect,
    disconnectAccount,
    getAppDetail,
    getProviderDetail,
    polling,
    summary,
    summaryWorkspaceKey,
    summaryError,
  } = connections
  const larkCli = useLarkCliConnection()
  const wecomCli = useWecomCliConnection()
  const [query, setQuery] = React.useState("")
  const [activeFilter, setActiveFilter] = React.useState<ConnectionCatalogFilter>(requestedFilter ?? { kind: "all" })
  const [selectedProviderService, setSelectedProviderService] = React.useState<string | null>(null)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const [detailPaneClosing, setDetailPaneClosing] = React.useState(false)
  const [dialog, setDialog] = React.useState<{
    appDetail?: ConnectionAppDetail | null
    appId?: string
    connectionName?: string
    authType: "api_key" | "custom_credential" | "federated" | "oauth2"
    detail: ConnectionProviderDetail
    oauthClientConfig?: ConnectionUserOAuthClientConfigSummary | null
  } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<DisconnectTarget | null>(null)
  const detailCloseTimerRef = React.useRef<number | null>(null)
  const connectionActionRequestIdRef = React.useRef(0)
  const detailWorkspaceKeyRef = React.useRef<string | null>(summaryWorkspaceKey)
  const listPaneRef = React.useRef<HTMLDivElement | null>(null)

  const larkCliProvider = React.useMemo(
    () =>
      larkCli.state
        ? larkCliProviderFromState(
            larkCli.state,
            {
              description: t("connections.larkCli.description"),
              displayName: t("connections.larkCli.name"),
            },
            larkCli.connectedUpdatedAt,
          )
        : null,
    [larkCli.connectedUpdatedAt, larkCli.state, t],
  )
  const wecomCliProvider = React.useMemo(
    () =>
      wecomCli.state
        ? wecomCliProviderFromState(
            wecomCli.state,
            {
              connectActionLabel: t("connections.wecomCli.connectAction"),
              connectionMethodLabel: t("connections.wecomCli.connectionMethod"),
              description: t("connections.wecomCli.description"),
              displayName: t("connections.wecomCli.name"),
            },
            wecomCli.connectedUpdatedAt,
          )
        : null,
    [t, wecomCli.connectedUpdatedAt, wecomCli.state],
  )
  const providers = React.useMemo(
    () => [
      ...(summary?.providers ?? []).filter(
        (provider) => provider.service !== "lark-cli" && provider.service !== wecomCliService,
      ),
      ...(larkCliProvider ? [larkCliProvider] : []),
      ...(wecomCliProvider ? [wecomCliProvider] : []),
    ],
    [larkCliProvider, summary?.providers, wecomCliProvider],
  )
  const deferredQuery = React.useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const categoryFilters = React.useMemo(() => buildCategoryFilters(providers, t), [providers, t])
  const connectedCount = React.useMemo(() => providers.filter(isConnected).length, [providers])
  const attentionCount = React.useMemo(
    () => providers.filter((provider) => provider.status === "needs_attention").length,
    [providers],
  )
  const directlyAvailableCount = React.useMemo(() => providers.filter(isDirectlyAvailableProvider).length, [providers])
  const availableToolsCount = connectedCount + directlyAvailableCount
  const showConnectionState = shouldShowConnectionState(summary?.appsStatus)
  const connectionActionsEnabled = canMutateConnections(canManageConnections, summary?.appsStatus)
  const catalogProviders = React.useMemo(
    () => providers.filter((provider) => matchesProviderFilter(provider, activeFilter)),
    [activeFilter, providers],
  )
  const filteredProviders = React.useMemo(() => {
    return catalogProviders
      .filter((provider) => matchesProviderQuery(provider, normalizedQuery, t))
      .sort(compareConnectionProvidersByRecommendation)
  }, [catalogProviders, normalizedQuery, t])
  const selectedProvider = selectedProviderService
    ? (filteredProviders.find((provider) => provider.service === selectedProviderService) ?? null)
    : null
  const selectedDirectService =
    selectedProvider?.service === "lark-cli" || selectedProvider?.service === wecomCliService
      ? selectedProvider.service
      : null
  const selectedDirectCli =
    selectedDirectService === "lark-cli" ? larkCli : selectedDirectService === wecomCliService ? wecomCli : null
  const selectedProviderIsDirect = selectedDirectCli !== null
  const selectedProviderActionsEnabled = selectedProviderIsDirect ? true : connectionActionsEnabled
  const providerDetail = useConnectionProviderDetail({
    enabled: selectedProviderActionsEnabled,
    getProviderDetail,
    provider: selectedProvider,
    workspaceKey: summaryWorkspaceKey,
  })
  const selectedProviderDetail =
    selectedProviderIsDirect && selectedProvider
      ? selectedDirectService === "lark-cli"
        ? larkCliProviderDetail(selectedProvider)
        : wecomCliProviderDetail(selectedProvider)
      : providerDetail.detail
  const selectedProviderDetailLoading = selectedProviderIsDirect ? false : providerDetail.loading
  const selectedProviderDetailError = selectedProviderIsDirect ? selectedDirectCli.error : providerDetail.error
  const selectedProviderActionsBlocked = Boolean(
    !selectedProviderActionsEnabled ||
    (selectedProviderIsDirect && selectedProvider?.actionKind === "unavailable") ||
    (!selectedProviderIsDirect && !showConnectionState) ||
    (providerDetail.needsDetail && !selectedProviderDetail && selectedProviderDetailError),
  )
  const selectedProviderActionsPending = Boolean(
    providerDetail.needsDetail && !selectedProviderDetail && selectedProviderDetailLoading,
  )
  const detailErrorNotice = selectedProvider
    ? getConnectionDetailErrorNotice({
        actionError: selectedProviderIsDirect ? selectedDirectCli.error : actionError,
        detailError: selectedProviderDetailError,
      })
    : null
  const larkCliBusy: UseConnections["busy"] =
    larkCli.state?.phase === "disconnecting"
      ? "disconnect"
      : larkCli.state && larkCli.state.phase !== "idle"
        ? "connect"
        : null
  const wecomCliBusy: UseConnections["busy"] =
    wecomCli.state?.phase === "disconnecting"
      ? "disconnect"
      : wecomCli.state && wecomCli.state.phase !== "idle"
        ? "connect"
        : null
  const selectedProviderBusy = selectedProviderIsDirect
    ? selectedDirectService === "lark-cli"
      ? larkCliBusy
      : wecomCliBusy
    : busy
  const confirmDisconnectBusy =
    confirmDisconnect?.provider.service === "lark-cli"
      ? larkCliBusy
      : confirmDisconnect?.provider.service === wecomCliService
        ? wecomCliBusy
        : busy
  const selectedProviderPolling = selectedProviderIsDirect
    ? selectedDirectCli.state &&
      selectedDirectCli.state.phase !== "idle" &&
      selectedDirectCli.state.phase !== "disconnecting"
      ? selectedDirectService
      : null
    : polling
  const selectedProviderProgressLabel = selectedProviderIsDirect
    ? selectedDirectService === "lark-cli"
      ? t(`connections.larkCli.phase.${larkCli.state?.phase ?? "idle"}`)
      : t(`connections.wecomCli.phase.${wecomCli.state?.phase ?? "idle"}`)
    : undefined
  const cancelSelectedProviderPolling = selectedProviderIsDirect ? selectedDirectCli.cancel : cancelPolling
  const reopenSelectedProviderPolling =
    selectedDirectService === wecomCliService && wecomCli.state?.canReopenAuthorization
      ? wecomCli.reopenAuthorization
      : undefined
  const reopenSelectedProviderPollingLabel = reopenSelectedProviderPolling
    ? t("connections.wecomCli.reopenAuthorization")
    : undefined
  const summaryLoading = busy === "refresh" && !summary
  const listErrorNotice = getConnectionListErrorNotice({ summaryError, detailError: detailErrorNotice?.error ?? null })
  const deleteCachedDetailForService = providerDetail.invalidate
  React.useEffect(() => {
    if (detailWorkspaceKeyRef.current === summaryWorkspaceKey) {
      return
    }
    detailWorkspaceKeyRef.current = summaryWorkspaceKey
    connectionActionRequestIdRef.current += 1
    setDialog(null)
    setConfirmDisconnect(null)
  }, [summaryWorkspaceKey])

  React.useEffect(() => {
    if (connectionActionsEnabled) return
    connectionActionRequestIdRef.current += 1
    setDialog(null)
    setConfirmDisconnect(null)
  }, [connectionActionsEnabled])

  const clearDetailCloseTimer = React.useCallback(() => {
    if (detailCloseTimerRef.current === null) {
      return
    }

    window.clearTimeout(detailCloseTimerRef.current)
    detailCloseTimerRef.current = null
  }, [])

  const selectProvider = React.useCallback(
    (service: string) => {
      clearDetailCloseTimer()
      setDetailPaneClosing(false)
      clearActionError()
      setSelectedProviderService(service)
      setNarrowPane("detail")
    },
    [clearActionError, clearDetailCloseTimer],
  )

  const closeDetail = React.useCallback(() => {
    if (!selectedProviderService) {
      setNarrowPane("list")
      return
    }

    clearDetailCloseTimer()
    setDetailPaneClosing(true)
    setNarrowPane("list")
    detailCloseTimerRef.current = window.setTimeout(() => {
      setSelectedProviderService(null)
      setDetailPaneClosing(false)
      detailCloseTimerRef.current = null
    }, detailPaneAnimationMs)
  }, [clearDetailCloseTimer, selectedProviderService])

  const requestedService = authIntent?.service ?? selectedService

  React.useEffect(() => {
    if (!requestedFilter) {
      return
    }

    setQuery("")
    setActiveFilter(requestedFilter)
  }, [requestedFilter])

  React.useEffect(() => {
    if (!requestedService) {
      return
    }

    setQuery("")
    setActiveFilter({ kind: "all" })
    selectProvider(requestedService)
  }, [requestedService, selectProvider])

  React.useEffect(() => clearDetailCloseTimer, [clearDetailCloseTimer])

  React.useEffect(() => {
    if (activeFilter.kind !== "category") {
      return
    }
    if (!categoryFilters.some((filter) => filter.label === activeFilter.category)) {
      setActiveFilter({ kind: "all" })
    }
  }, [activeFilter, categoryFilters])

  React.useEffect(() => {
    if (showConnectionState) {
      return
    }
    if (
      activeFilter.kind === "available-tools" ||
      activeFilter.kind === "connected" ||
      activeFilter.kind === "attention"
    ) {
      setActiveFilter({ kind: "all" })
    }
  }, [activeFilter.kind, showConnectionState])

  React.useEffect(() => {
    if (!selectedProviderService) {
      return
    }

    if (
      filteredProviders.some((provider) => provider.service === selectedProviderService) ||
      (selectedProviderService === "lark-cli" && !larkCliProvider) ||
      (selectedProviderService === wecomCliService && !wecomCliProvider)
    ) {
      return
    }

    clearDetailCloseTimer()
    setSelectedProviderService(null)
    setDetailPaneClosing(false)
    setNarrowPane("list")
  }, [clearDetailCloseTimer, filteredProviders, larkCliProvider, selectedProviderService, wecomCliProvider])

  const connectProvider = React.useCallback(
    async (
      provider: ConnectionProviderSummary,
      authType: Exclude<ConnectionAuthType, null>,
      appId?: string,
    ): Promise<void> => {
      if (provider.executionMode === "direct") {
        const directCli =
          provider.service === "lark-cli" ? larkCli : provider.service === wecomCliService ? wecomCli : null
        if (!directCli) return
        const ok = await directCli.connect()
        if (ok) {
          onConnectionReady?.({ service: provider.service, connectionName: "default" })
        }
        return
      }
      if (!connectionActionsEnabled) {
        return
      }
      if (polling && !isConnectionServicePollingTarget(polling, provider.service)) {
        return
      }
      const requestId = connectionActionRequestIdRef.current + 1
      connectionActionRequestIdRef.current = requestId
      const requestIsCurrent = (): boolean => connectionActionRequestIdRef.current === requestId
      const loadProviderDetail = () => providerDetail.loadCached(provider.service)
      try {
        if (authType === "oauth2") {
          const loaded = await loadProviderDetail()
          const oauthClientConfig = loaded.oauthClientConfig ? await getOAuthClientConfig(provider.service) : null
          if (!requestIsCurrent()) {
            return
          }
          if (
            shouldOpenOAuthClientDialog({
              providerOAuthClientConfig: loaded.oauthClientConfig,
              userOAuthClientConfig: oauthClientConfig,
            })
          ) {
            setDialog({
              detail: loaded,
              authType,
              appId,
              connectionName: provider.apps.find((app) => app.id === appId)?.connectionName,
              oauthClientConfig,
            })
            return
          }

          const ok = await connect({ authType, service: provider.service, appId })
          if (!requestIsCurrent()) {
            return
          }
          if (ok) {
            deleteCachedDetailForService(provider.service)
            onConnectionReady?.({
              service: provider.service,
              connectionName: provider.apps.find((app) => app.id === appId)?.connectionName,
            })
          }
          return
        }

        if (authType === "no_auth") {
          const ok = await connect({ authType, service: provider.service })
          if (!requestIsCurrent()) {
            return
          }
          if (ok) {
            deleteCachedDetailForService(provider.service)
            onConnectionReady?.({ service: provider.service })
          }
          return
        }

        const [loaded, appDetail] = await Promise.all([
          loadProviderDetail(),
          appId ? getAppDetail(appId).catch(() => null) : Promise.resolve(null),
        ])
        if (!requestIsCurrent()) {
          return
        }
        setDialog({
          detail: loaded,
          authType,
          appId,
          appDetail,
          connectionName: provider.apps.find((app) => app.id === appId)?.connectionName,
        })
      } catch (err) {
        if (requestIsCurrent()) {
          providerDetail.reportError(err)
        }
      }
    },
    [
      connectionActionsEnabled,
      connect,
      deleteCachedDetailForService,
      getAppDetail,
      larkCli,
      onConnectionReady,
      polling,
      providerDetail,
      wecomCli,
    ],
  )

  const submitConnectDialog = React.useCallback(
    (input: ConnectionConnectInput): void => {
      if (!connectionActionsEnabled) {
        return
      }
      const requestId = connectionActionRequestIdRef.current + 1
      connectionActionRequestIdRef.current = requestId
      const requestIsCurrent = (): boolean => connectionActionRequestIdRef.current === requestId
      void (async () => {
        const ok = await connect(input)
        if (!requestIsCurrent()) {
          return
        }
        if (ok) {
          deleteCachedDetailForService(input.service)
          onConnectionReady?.({
            service: input.service,
            connectionName: dialog?.connectionName,
          })
          setDialog(null)
        }
      })()
      if (input.authType === "oauth2") {
        setDialog(null)
      }
    },
    [connect, connectionActionsEnabled, deleteCachedDetailForService, dialog, onConnectionReady],
  )

  const requestDisconnectTarget = React.useCallback(
    (target: DisconnectTarget): void => {
      if (target.provider.executionMode !== "direct" && !connectionActionsEnabled) {
        return
      }
      setConfirmDisconnect(target)
    },
    [connectionActionsEnabled],
  )

  const confirmDisconnectTarget = React.useCallback(
    async (target: DisconnectTarget): Promise<void> => {
      if (target.provider.executionMode !== "direct" && !connectionActionsEnabled) {
        setConfirmDisconnect(null)
        return
      }
      const requestId = connectionActionRequestIdRef.current + 1
      connectionActionRequestIdRef.current = requestId
      const ok =
        target.provider.executionMode === "direct"
          ? target.provider.service === "lark-cli"
            ? await larkCli.disconnect()
            : target.provider.service === wecomCliService
              ? await wecomCli.disconnect()
              : false
          : target.app
            ? await disconnectAccount(target.app.id)
            : await disconnect(target.provider.service)
      if (connectionActionRequestIdRef.current !== requestId) {
        return
      }
      if (ok) {
        deleteCachedDetailForService(target.provider.service)
        setConfirmDisconnect(null)
      }
    },
    [connectionActionsEnabled, deleteCachedDetailForService, disconnect, disconnectAccount, larkCli, wecomCli],
  )

  if (presentation === "drawer") {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
        {selectedProvider ? (
          <ProviderDetail
            authIntent={authIntent?.service === selectedProvider.service ? authIntent : null}
            busy={selectedProviderBusy}
            detail={selectedProviderDetail}
            actionsBlocked={selectedProviderActionsBlocked}
            canManageConnections={selectedProviderIsDirect || canManageConnections}
            actionsPending={selectedProviderActionsPending}
            errorNotice={detailErrorNotice}
            detailLoading={selectedProviderDetailLoading}
            connections={connections}
            onCancelPolling={cancelSelectedProviderPolling}
            onClose={onClose ?? closeDetail}
            onConnect={connectProvider}
            onDisconnect={requestDisconnectTarget}
            onReopenPolling={reopenSelectedProviderPolling}
            polling={selectedProviderPolling}
            progressLabel={selectedProviderProgressLabel}
            reopenPollingLabel={reopenSelectedProviderPollingLabel}
            provider={selectedProvider}
            showCloseButton
          />
        ) : (
          <section className="grid gap-2 rounded-lg border bg-muted/30 px-3 py-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="oo-text-label min-w-0 truncate">
                {authIntent?.displayName ?? selectedService ?? t("connections.title")}
              </div>
              {onClose ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={t("connections.closeProviderDetails")}
                  title={t("connections.closeProviderDetails")}
                  onClick={onClose}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
            {summaryError ? (
              <div className="oo-text-caption oo-text-muted">{userFacingErrorDescription(summaryError, t)}</div>
            ) : (
              <ConnectionDrawerSkeleton />
            )}
          </section>
        )}
        <ConnectDialog
          open={dialog !== null}
          appDetail={dialog?.appDetail}
          detail={dialog?.detail ?? null}
          authType={dialog?.authType ?? null}
          appId={dialog?.appId}
          oauthClientConfig={dialog?.oauthClientConfig}
          busy={busy === "connect"}
          onClose={() => setDialog(null)}
          onSubmit={submitConnectDialog}
          onOpenUrl={(url) => void connections.openExternal(url)}
        />
        <DisconnectDialog
          target={confirmDisconnect}
          busy={confirmDisconnectBusy === "disconnect"}
          onClose={() => setConfirmDisconnect(null)}
          onConfirm={confirmDisconnectTarget}
        />
      </div>
    )
  }

  return (
    <SplitViewRoot narrowPane={narrowPane}>
      <SplitViewHeader narrowPane={narrowPane} className="oo-border-divider border-b sm:grid-cols-1">
        <ConnectionListToolbar
          activeFilter={activeFilter}
          attentionCount={attentionCount}
          availableToolsCount={availableToolsCount}
          categoryFilters={categoryFilters}
          connectedCount={connectedCount}
          directlyAvailableCount={directlyAvailableCount}
          loading={summaryLoading}
          query={query}
          showConnectionState={showConnectionState}
          totalCount={providers.length}
          onFilterChange={setActiveFilter}
          onQueryChange={setQuery}
        />
      </SplitViewHeader>

      <SplitViewBody
        desktopLayout={selectedProvider ? "default" : "single"}
        className="motion-reduce:transition-none min-[960px]:transition-[grid-template-columns] min-[960px]:duration-200 min-[960px]:ease-out"
      >
        <SplitViewListPane ref={listPaneRef} narrowPane={narrowPane} className="pt-3">
          <div className="grid gap-3">
            {summary?.appsStatus && summary.appsStatus !== "ready" ? (
              <ConnectionStateNotice status={summary.appsStatus} />
            ) : null}
            {listErrorNotice ? (
              <ErrorNotice
                error={listErrorNotice.error}
                compact
                showDiagnosticsCopy={listErrorNotice.showDiagnosticsCopy}
              />
            ) : null}
            {summaryLoading ? (
              <ProviderListSkeleton />
            ) : filteredProviders.length === 0 ? (
              <EmptyList summary={summary} hasQuery={Boolean(normalizedQuery)} />
            ) : (
              <ProviderCatalog
                canManageConnections={canManageConnections}
                providers={filteredProviders}
                scrollParentRef={listPaneRef}
                selectedService={selectedProvider?.service ?? null}
                showConnectionState={showConnectionState}
                onSelect={(provider) => selectProvider(provider.service)}
              />
            )}
          </div>
        </SplitViewListPane>

        {selectedProvider ? (
          <SplitViewMobileDetailPane narrowPane={narrowPane}>
            <div className="mb-2">
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                <ArrowLeft className="size-4" />
                {t("connections.backToProviders")}
              </Button>
            </div>
            <ProviderDetail
              authIntent={authIntent?.service === selectedProvider.service ? authIntent : null}
              busy={selectedProviderBusy}
              detail={selectedProviderDetail}
              actionsBlocked={selectedProviderActionsBlocked}
              canManageConnections={selectedProviderIsDirect || canManageConnections}
              actionsPending={selectedProviderActionsPending}
              errorNotice={detailErrorNotice}
              detailLoading={selectedProviderDetailLoading}
              connections={connections}
              onCancelPolling={cancelSelectedProviderPolling}
              onClose={closeDetail}
              onConnect={connectProvider}
              onDisconnect={requestDisconnectTarget}
              onReopenPolling={reopenSelectedProviderPolling}
              polling={selectedProviderPolling}
              progressLabel={selectedProviderProgressLabel}
              reopenPollingLabel={reopenSelectedProviderPollingLabel}
              provider={selectedProvider}
            />
          </SplitViewMobileDetailPane>
        ) : null}

        {selectedProvider ? (
          <SplitViewDesktopDetailPane
            className={cn(
              "pt-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
              detailPaneClosing
                ? "pointer-events-none translate-x-2 opacity-0"
                : "translate-x-0 animate-in opacity-100 fade-in-0 slide-in-from-right-2 motion-reduce:animate-none",
            )}
          >
            <ProviderDetail
              authIntent={authIntent?.service === selectedProvider.service ? authIntent : null}
              busy={selectedProviderBusy}
              detail={selectedProviderDetail}
              actionsBlocked={selectedProviderActionsBlocked}
              canManageConnections={selectedProviderIsDirect || canManageConnections}
              actionsPending={selectedProviderActionsPending}
              errorNotice={detailErrorNotice}
              detailLoading={selectedProviderDetailLoading}
              connections={connections}
              onCancelPolling={cancelSelectedProviderPolling}
              onClose={closeDetail}
              onConnect={connectProvider}
              onDisconnect={requestDisconnectTarget}
              onReopenPolling={reopenSelectedProviderPolling}
              polling={selectedProviderPolling}
              progressLabel={selectedProviderProgressLabel}
              reopenPollingLabel={reopenSelectedProviderPollingLabel}
              provider={selectedProvider}
            />
          </SplitViewDesktopDetailPane>
        ) : null}
      </SplitViewBody>

      <ConnectDialog
        open={dialog !== null}
        appDetail={dialog?.appDetail}
        detail={dialog?.detail ?? null}
        authType={dialog?.authType ?? null}
        appId={dialog?.appId}
        oauthClientConfig={dialog?.oauthClientConfig}
        busy={busy === "connect"}
        onClose={() => setDialog(null)}
        onSubmit={submitConnectDialog}
        onOpenUrl={(url) => void connections.openExternal(url)}
      />

      <DisconnectDialog
        target={confirmDisconnect}
        busy={confirmDisconnectBusy === "disconnect"}
        onClose={() => setConfirmDisconnect(null)}
        onConfirm={confirmDisconnectTarget}
      />
    </SplitViewRoot>
  )
}
