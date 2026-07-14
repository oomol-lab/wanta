import type {
  ConnectionAuthType,
  ConnectionAppDetail,
  ConnectionConnectInput,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionUserOAuthClientConfigSummary,
} from "../../../electron/connections/common.ts"
import type { ConnectionCatalogFilter, DisconnectTarget } from "./connection-route-model.ts"
import type { ConnectionAuthIntent } from "./ConnectionProviderDetailPane.tsx"
import type { UseConnections } from "@/hooks/useConnections"

import { ArrowLeft, X } from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { getConnectionDetailErrorNotice, getConnectionListErrorNotice } from "./connection-error-display.ts"
import { compareConnectionProvidersByRecommendation } from "./connection-provider-ranking.ts"
import {
  buildCategoryFilters,
  detailPaneAnimationMs,
  isConnected,
  isDirectlyAvailableProvider,
  matchesProviderFilter,
  matchesProviderQuery,
} from "./connection-route-model.ts"
import {
  ConnectionDrawerSkeleton,
  ConnectionListToolbar,
  ProviderCatalog,
  ProviderListSkeleton,
} from "./ConnectionCatalog.tsx"
import { EmptyList, ProviderDetail, StatusNotice } from "./ConnectionProviderDetailPane.tsx"
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
import { useT } from "@/i18n/i18n"
import { getOAuthClientConfig } from "@/lib/connections-client"
import { userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

export type { ConnectionAuthIntent } from "./ConnectionProviderDetailPane.tsx"

interface ConnectionsPanelProps {
  authIntent?: ConnectionAuthIntent | null
  connections: UseConnections
  onClose?: () => void
  presentation?: "drawer" | "page"
  selectedService?: string | null
}

export function ConnectionsPanel({
  authIntent,
  connections,
  onClose,
  presentation = "page",
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
    getAppDetail,
    getProviderDetail,
    polling,
    summary,
    summaryWorkspaceKey,
    summaryError,
  } = connections
  const [query, setQuery] = React.useState("")
  const [activeFilter, setActiveFilter] = React.useState<ConnectionCatalogFilter>({ kind: "all" })
  const [selectedProviderService, setSelectedProviderService] = React.useState<string | null>(null)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const [detailPaneClosing, setDetailPaneClosing] = React.useState(false)
  const [dialog, setDialog] = React.useState<{
    appDetail?: ConnectionAppDetail | null
    appId?: string
    authType: "api_key" | "custom_credential" | "federated" | "oauth2"
    detail: ConnectionProviderDetail
    oauthClientConfig?: ConnectionUserOAuthClientConfigSummary | null
  } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<DisconnectTarget | null>(null)
  const detailCloseTimerRef = React.useRef<number | null>(null)
  const connectRequestIdRef = React.useRef(0)
  const detailWorkspaceKeyRef = React.useRef<string | null>(summaryWorkspaceKey)
  const listPaneRef = React.useRef<HTMLDivElement | null>(null)

  const providers = summary?.providers ?? []
  const deferredQuery = React.useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const categoryFilters = React.useMemo(() => buildCategoryFilters(providers, t), [providers, t])
  const connectedCount = React.useMemo(() => providers.filter(isConnected).length, [providers])
  const attentionCount = React.useMemo(
    () => providers.filter((provider) => provider.status === "needs_attention").length,
    [providers],
  )
  const directlyAvailableCount = React.useMemo(() => providers.filter(isDirectlyAvailableProvider).length, [providers])
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
  const providerDetail = useConnectionProviderDetail({
    getProviderDetail,
    provider: selectedProvider,
    workspaceKey: summaryWorkspaceKey,
  })
  const selectedProviderDetail = providerDetail.detail
  const selectedProviderDetailLoading = providerDetail.loading
  const selectedProviderDetailError = providerDetail.error
  const selectedProviderActionsBlocked = Boolean(
    providerDetail.needsDetail && !selectedProviderDetail && selectedProviderDetailError,
  )
  const selectedProviderActionsPending = Boolean(
    providerDetail.needsDetail && !selectedProviderDetail && selectedProviderDetailLoading,
  )
  const detailErrorNotice = selectedProvider
    ? getConnectionDetailErrorNotice({
        actionError,
        detailError: selectedProviderDetailError,
        workspace: summary?.workspace ?? null,
      })
    : null
  const summaryLoading = busy === "refresh" && !summary
  const listErrorNotice = getConnectionListErrorNotice({ summaryError, detailError: detailErrorNotice?.error ?? null })
  const deleteCachedDetailForService = providerDetail.invalidate
  React.useEffect(() => {
    if (detailWorkspaceKeyRef.current === summaryWorkspaceKey) {
      return
    }
    detailWorkspaceKeyRef.current = summaryWorkspaceKey
    connectRequestIdRef.current += 1
    setDialog(null)
    setConfirmDisconnect(null)
  }, [summaryWorkspaceKey])

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
    if (!selectedProviderService || !summary) {
      return
    }

    if (filteredProviders.some((provider) => provider.service === selectedProviderService)) {
      return
    }

    clearDetailCloseTimer()
    setSelectedProviderService(null)
    setDetailPaneClosing(false)
    setNarrowPane("list")
  }, [clearDetailCloseTimer, filteredProviders, selectedProviderService, summary])

  const connectProvider = React.useCallback(
    async (
      provider: ConnectionProviderSummary,
      authType: Exclude<ConnectionAuthType, null>,
      appId?: string,
    ): Promise<void> => {
      if (polling && !isConnectionServicePollingTarget(polling, provider.service)) {
        return
      }
      const requestId = connectRequestIdRef.current + 1
      connectRequestIdRef.current = requestId
      const requestIsCurrent = (): boolean => connectRequestIdRef.current === requestId
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
            setDialog({ detail: loaded, authType, appId, oauthClientConfig })
            return
          }

          const ok = await connect({ authType, service: provider.service, appId })
          if (!requestIsCurrent()) {
            return
          }
          if (ok) {
            deleteCachedDetailForService(provider.service)
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
        setDialog({ detail: loaded, authType, appId, appDetail })
      } catch (err) {
        if (requestIsCurrent()) {
          providerDetail.reportError(err)
        }
      }
    },
    [connect, deleteCachedDetailForService, getAppDetail, polling, providerDetail],
  )

  const submitConnectDialog = React.useCallback(
    (input: ConnectionConnectInput): void => {
      void (async () => {
        const ok = await connect(input)
        if (ok) {
          deleteCachedDetailForService(input.service)
          setDialog(null)
        }
      })()
      if (input.authType === "oauth2") {
        setDialog(null)
      }
    },
    [connect, deleteCachedDetailForService],
  )

  if (presentation === "drawer") {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
        {selectedProvider ? (
          <ProviderDetail
            authIntent={authIntent?.service === selectedProvider.service ? authIntent : null}
            busy={busy}
            detail={selectedProviderDetail}
            actionsBlocked={selectedProviderActionsBlocked}
            actionsPending={selectedProviderActionsPending}
            errorNotice={detailErrorNotice}
            detailLoading={selectedProviderDetailLoading}
            connections={connections}
            onCancelPolling={cancelPolling}
            onClose={onClose ?? closeDetail}
            onConnect={connectProvider}
            onDisconnect={setConfirmDisconnect}
            polling={polling}
            provider={selectedProvider}
            summary={summary}
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
          busy={busy === "disconnect"}
          onClose={() => setConfirmDisconnect(null)}
          onConfirm={async (target) => {
            const ok = target.app
              ? await connections.disconnectAccount(target.app.id)
              : await disconnect(target.provider.service)
            if (ok) {
              deleteCachedDetailForService(target.provider.service)
              setConfirmDisconnect(null)
            }
          }}
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
          categoryFilters={categoryFilters}
          connectedCount={connectedCount}
          directlyAvailableCount={directlyAvailableCount}
          loading={summaryLoading}
          query={query}
          totalCount={summary?.providerCount ?? providers.length}
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
            {summary && summary.status !== "ready" && <StatusNotice summary={summary} />}
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
                providers={filteredProviders}
                scrollParentRef={listPaneRef}
                selectedService={selectedProvider?.service ?? null}
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
              busy={busy}
              detail={selectedProviderDetail}
              actionsBlocked={selectedProviderActionsBlocked}
              actionsPending={selectedProviderActionsPending}
              errorNotice={detailErrorNotice}
              detailLoading={selectedProviderDetailLoading}
              connections={connections}
              onCancelPolling={cancelPolling}
              onClose={closeDetail}
              onConnect={connectProvider}
              onDisconnect={setConfirmDisconnect}
              polling={polling}
              provider={selectedProvider}
              summary={summary}
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
              busy={busy}
              detail={selectedProviderDetail}
              actionsBlocked={selectedProviderActionsBlocked}
              actionsPending={selectedProviderActionsPending}
              errorNotice={detailErrorNotice}
              detailLoading={selectedProviderDetailLoading}
              connections={connections}
              onCancelPolling={cancelPolling}
              onClose={closeDetail}
              onConnect={connectProvider}
              onDisconnect={setConfirmDisconnect}
              polling={polling}
              provider={selectedProvider}
              summary={summary}
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
        busy={busy === "disconnect"}
        onClose={() => setConfirmDisconnect(null)}
        onConfirm={async (target) => {
          const ok = target.app
            ? await connections.disconnectAccount(target.app.id)
            : await disconnect(target.provider.service)
          if (ok) {
            deleteCachedDetailForService(target.provider.service)
            setConfirmDisconnect(null)
          }
        }}
      />
    </SplitViewRoot>
  )
}
