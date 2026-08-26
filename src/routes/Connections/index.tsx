import type {
  ConnectionAppSummary,
  ConnectionAuthType,
  ConnectionAppDetail,
  ConnectionConnectInput,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionUserOAuthClientConfigSummary,
} from "../../../electron/connections/common.ts"
import type { ConnectionProviderSortMode } from "./connection-provider-ranking.ts"
import type {
  ConnectionAuthFilter,
  ConnectionAuthIntent,
  ConnectionCatalogFilter,
  ConnectionDiscoveryCategory,
  DisconnectTarget,
} from "./connection-route-model.ts"
import type { ConnectionAccessContext } from "./ConnectionAccessDialog.tsx"
import type { UseConnections } from "@/hooks/useConnections"

import { ArrowLeft, X } from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { getConnectionDetailErrorNotice, getConnectionListErrorNotice } from "./connection-error-display.ts"
import { compareConnectionProviders } from "./connection-provider-ranking.ts"
import {
  canMutateConnections,
  detailPaneAnimationMs,
  getConnectionDiscoveryCategory,
  isConnected,
  isDirectlyAvailableProvider,
  isManagedConnection,
  matchesConnectionDiscoveryCategory,
  matchesProviderAuthFilter,
  matchesProviderFilter,
  matchesProviderQuery,
  shouldShowConnectionState,
} from "./connection-route-model.ts"
import { ConnectionAccessDialog } from "./ConnectionAccessDialog.tsx"
import {
  ConnectionDrawerSkeleton,
  ConnectionListToolbar,
  ProviderCatalog,
  ProviderListSkeleton,
} from "./ConnectionCatalog.tsx"
import { ConnectionStateNotice, EmptyList, ProviderDetail } from "./ConnectionProviderDetailPane.tsx"
import { ConnectionDiscoveryCategoryHeader, ConnectionScenarioShowcase } from "./ConnectionScenarioShowcase.tsx"
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
  useDesktopSplitView,
} from "@/components/ui/split-view"
import { isConnectionServicePollingTarget } from "@/hooks/connection-oauth-pending"
import {
  dingTalkCliProviderDetail,
  dingTalkCliProviderFromState,
  dingTalkCliService,
  useDingTalkCliConnection,
} from "@/hooks/useDingTalkCliConnection"
import {
  larkCliProviderDetail,
  larkCliProviderFromState,
  larkCliService,
  useLarkCliConnection,
} from "@/hooks/useLarkCliConnection"
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

type ConnectionsView = "discover" | "manage"

const connectionViews: readonly ConnectionsView[] = ["discover", "manage"]

interface ConnectionsPanelProps {
  accessContext?: ConnectionAccessContext
  authIntent?: ConnectionAuthIntent | null
  canManageConnections: boolean
  connections: UseConnections
  onClose?: () => void
  onConnectionReady?: (target: { service: string; connectionName?: string }) => void
  presentation?: "drawer" | "page"
  requestedFilter?: ConnectionCatalogFilter
  selectedAppId?: string | null
  selectedService?: string | null
}

interface DirectProviderBinding {
  busy: UseConnections["busy"]
  cancel: () => void
  connect: () => Promise<boolean>
  detail: (provider: ConnectionProviderSummary) => ConnectionProviderDetail
  disconnect: () => Promise<boolean>
  error: UseConnections["actionError"]
  phase: string
  phaseLabel: string
  provider: ConnectionProviderSummary | null
  reopenPolling?: () => void
  reopenPollingLabel?: string
}

export function ConnectionsPanel({
  accessContext,
  authIntent,
  canManageConnections,
  connections,
  onClose,
  onConnectionReady,
  presentation = "page",
  requestedFilter,
  selectedAppId,
  selectedService,
}: ConnectionsPanelProps) {
  const t = useT()
  const desktopSplitView = useDesktopSplitView()
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
  const dingTalkCli = useDingTalkCliConnection()
  const [query, setQuery] = React.useState("")
  const [activeFilter, setActiveFilter] = React.useState<ConnectionCatalogFilter>(requestedFilter ?? { kind: "all" })
  const [authFilter, setAuthFilter] = React.useState<ConnectionAuthFilter>("all")
  const [sortMode, setSortMode] = React.useState<ConnectionProviderSortMode>("recommended")
  const [view, setView] = React.useState<ConnectionsView>("discover")
  const [discoveryCategory, setDiscoveryCategory] = React.useState<ConnectionDiscoveryCategory | null>(null)
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
  const [accessApp, setAccessApp] = React.useState<ConnectionAppSummary | null>(null)
  const detailCloseTimerRef = React.useRef<number | null>(null)
  const connectionActionRequestIdRef = React.useRef(0)
  const detailWorkspaceKeyRef = React.useRef<string | null>(summaryWorkspaceKey)
  const handledSelectedAccessAppIdRef = React.useRef<string | null>(null)
  const listPaneRef = React.useRef<HTMLDivElement | null>(null)
  const previousViewWorkspaceRef = React.useRef(summaryWorkspaceKey)

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
  const dingTalkCliProvider = React.useMemo(
    () =>
      dingTalkCli.state
        ? dingTalkCliProviderFromState(
            dingTalkCli.state,
            {
              connectActionLabel:
                dingTalkCli.state.connection === "connected"
                  ? t("connections.dingTalkCli.switchAccountAction")
                  : dingTalkCli.state.connection === "expired"
                    ? t("connections.dingTalkCli.reauthorizeAction")
                    : t("connections.dingTalkCli.connectAction"),
              connectionMethodLabel: t("connections.dingTalkCli.connectionMethod"),
              description: t("connections.dingTalkCli.description"),
              displayName: t("connections.dingTalkCli.name"),
            },
            dingTalkCli.connectedUpdatedAt,
          )
        : null,
    [dingTalkCli.connectedUpdatedAt, dingTalkCli.state, t],
  )
  const providers = React.useMemo(
    () => [
      ...(summary?.providers ?? []).filter(
        (provider) =>
          provider.service !== larkCliService &&
          provider.service !== wecomCliService &&
          provider.service !== dingTalkCliService,
      ),
      ...(larkCliProvider ? [larkCliProvider] : []),
      ...(wecomCliProvider ? [wecomCliProvider] : []),
      ...(dingTalkCliProvider ? [dingTalkCliProvider] : []),
    ],
    [dingTalkCliProvider, larkCliProvider, summary?.providers, wecomCliProvider],
  )
  const deferredQuery = React.useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const connectedCount = React.useMemo(() => providers.filter(isConnected).length, [providers])
  const attentionCount = React.useMemo(
    () => providers.filter((provider) => provider.status === "needs_attention").length,
    [providers],
  )
  const managedConnectionCount = React.useMemo(() => providers.filter(isManagedConnection).length, [providers])
  const directlyAvailableCount = React.useMemo(() => providers.filter(isDirectlyAvailableProvider).length, [providers])
  const availableToolsCount = connectedCount + directlyAvailableCount
  const showConnectionState = shouldShowConnectionState(summary?.appsStatus)
  const connectionActionsEnabled = canMutateConnections(canManageConnections, summary?.appsStatus)
  const discoveryProviders = React.useMemo(
    () =>
      view === "discover" && discoveryCategory
        ? providers.filter((provider) => matchesConnectionDiscoveryCategory(provider, discoveryCategory))
        : providers,
    [discoveryCategory, providers, view],
  )
  const catalogProviders = React.useMemo(
    () => discoveryProviders.filter((provider) => matchesProviderFilter(provider, activeFilter)),
    [activeFilter, discoveryProviders],
  )
  const filteredProviders = React.useMemo(() => {
    return catalogProviders
      .filter((provider) => matchesProviderAuthFilter(provider, authFilter))
      .filter((provider) => matchesProviderQuery(provider, normalizedQuery, t))
      .sort((left, right) => compareConnectionProviders(left, right, sortMode))
  }, [authFilter, catalogProviders, normalizedQuery, sortMode, t])
  const discoveryProviderCount = discoveryCategory ? discoveryProviders.length : null
  const discoveryCategoryTitle = discoveryCategory
    ? t(getConnectionDiscoveryCategory(discoveryCategory).titleKey)
    : null
  const discoveryAvailableToolsCount = React.useMemo(
    () =>
      discoveryProviders.filter((provider) => isConnected(provider) || isDirectlyAvailableProvider(provider)).length,
    [discoveryProviders],
  )
  const discoveryDirectlyAvailableCount = React.useMemo(
    () => discoveryProviders.filter(isDirectlyAvailableProvider).length,
    [discoveryProviders],
  )
  const discoveryConnectedCount = React.useMemo(
    () => discoveryProviders.filter(isConnected).length,
    [discoveryProviders],
  )

  const selectScenario = React.useCallback((category: ConnectionDiscoveryCategory) => {
    setView("discover")
    setDiscoveryCategory(category)
    setQuery("")
    setAuthFilter("all")
    setSortMode("recommended")
    setSelectedProviderService(null)
    setNarrowPane("list")
  }, [])
  const leaveDiscoveryCategory = React.useCallback(() => {
    setDiscoveryCategory(null)
    setQuery("")
    setAuthFilter("all")
    setSortMode("recommended")
    setSelectedProviderService(null)
    setNarrowPane("list")
    listPaneRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [])
  const selectView = React.useCallback(
    (nextView: ConnectionsView) => {
      if (nextView === view) return
      setView(nextView)
      setDiscoveryCategory(null)
      setQuery("")
      setAuthFilter("all")
      setSortMode("recommended")
      setActiveFilter(nextView === "manage" ? { kind: "managed" } : { kind: "all" })
      setSelectedProviderService(null)
      setNarrowPane("list")
    },
    [view],
  )
  const handleViewTabKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const currentIndex = connectionViews.indexOf(view)
      const nextView =
        event.key === "ArrowRight"
          ? connectionViews[(currentIndex + 1) % connectionViews.length]
          : event.key === "ArrowLeft"
            ? connectionViews[(currentIndex - 1 + connectionViews.length) % connectionViews.length]
            : event.key === "Home"
              ? connectionViews[0]
              : event.key === "End"
                ? connectionViews.at(-1)
                : undefined

      if (!nextView) return

      event.preventDefault()
      selectView(nextView)
      window.requestAnimationFrame(() => {
        document.getElementById(`connections-${nextView}-tab`)?.focus()
      })
    },
    [selectView, view],
  )
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
  const dingTalkCliBusy: UseConnections["busy"] =
    dingTalkCli.state?.phase === "disconnecting"
      ? "disconnect"
      : dingTalkCli.state && dingTalkCli.state.phase !== "idle"
        ? "connect"
        : null
  const directProviderByService = React.useMemo<Record<string, DirectProviderBinding>>(
    () => ({
      [larkCliService]: {
        busy: larkCliBusy,
        cancel: larkCli.cancel,
        connect: larkCli.connect,
        detail: larkCliProviderDetail,
        disconnect: larkCli.disconnect,
        error: larkCli.error,
        phase: larkCli.state?.phase ?? "idle",
        phaseLabel: t(`connections.larkCli.phase.${larkCli.state?.phase ?? "idle"}`),
        provider: larkCliProvider,
      },
      [wecomCliService]: {
        busy: wecomCliBusy,
        cancel: wecomCli.cancel,
        connect: wecomCli.connect,
        detail: wecomCliProviderDetail,
        disconnect: wecomCli.disconnect,
        error: wecomCli.error,
        phase: wecomCli.state?.phase ?? "idle",
        phaseLabel: t(`connections.wecomCli.phase.${wecomCli.state?.phase ?? "idle"}`),
        provider: wecomCliProvider,
        reopenPolling: wecomCli.state?.canReopenAuthorization ? wecomCli.reopenAuthorization : undefined,
        reopenPollingLabel: t("connections.wecomCli.reopenAuthorization"),
      },
      [dingTalkCliService]: {
        busy: dingTalkCliBusy,
        cancel: dingTalkCli.cancel,
        connect: dingTalkCli.connect,
        detail: dingTalkCliProviderDetail,
        disconnect: dingTalkCli.disconnect,
        error: dingTalkCli.error,
        phase: dingTalkCli.state?.phase ?? "idle",
        phaseLabel: t(`connections.dingTalkCli.phase.${dingTalkCli.state?.phase ?? "idle"}`),
        provider: dingTalkCliProvider,
        reopenPolling: dingTalkCli.state?.canReopenAuthorization ? dingTalkCli.reopenAuthorization : undefined,
        reopenPollingLabel: t("connections.dingTalkCli.reopenAuthorization"),
      },
    }),
    [
      dingTalkCli,
      dingTalkCliBusy,
      dingTalkCliProvider,
      larkCli,
      larkCliBusy,
      larkCliProvider,
      t,
      wecomCli,
      wecomCliBusy,
      wecomCliProvider,
    ],
  )
  const selectedProvider = selectedProviderService
    ? (filteredProviders.find((provider) => provider.service === selectedProviderService) ?? null)
    : null
  React.useEffect(() => {
    if (!selectedAppId) {
      handledSelectedAccessAppIdRef.current = null
      return
    }
    if (!accessContext || handledSelectedAccessAppIdRef.current === selectedAppId) return
    const app = selectedProvider?.apps.find((item) => item.id === selectedAppId)
    if (!app) return
    handledSelectedAccessAppIdRef.current = selectedAppId
    setAccessApp(app)
  }, [accessContext, selectedAppId, selectedProvider])
  const selectedDirectProvider = selectedProvider ? directProviderByService[selectedProvider.service] : undefined
  const selectedProviderIsDirect = selectedDirectProvider !== undefined
  const selectedProviderActionsEnabled = selectedProviderIsDirect ? true : connectionActionsEnabled
  const providerDetail = useConnectionProviderDetail({
    enabled: selectedProviderActionsEnabled,
    getProviderDetail,
    provider: selectedProvider,
    workspaceKey: summaryWorkspaceKey,
  })
  const selectedProviderDetail =
    selectedDirectProvider && selectedProvider ? selectedDirectProvider.detail(selectedProvider) : providerDetail.detail
  const selectedProviderDetailLoading = selectedProviderIsDirect ? false : providerDetail.loading
  const selectedProviderDetailError = selectedDirectProvider ? selectedDirectProvider.error : providerDetail.error
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
        actionError: selectedDirectProvider ? selectedDirectProvider.error : actionError,
        detailError: selectedProviderDetailError,
      })
    : null
  const selectedProviderBusy = selectedDirectProvider ? selectedDirectProvider.busy : busy
  const confirmDirectProvider = confirmDisconnect
    ? directProviderByService[confirmDisconnect.provider.service]
    : undefined
  const confirmDisconnectBusy = confirmDirectProvider ? confirmDirectProvider.busy : busy
  const selectedProviderPolling = selectedDirectProvider
    ? selectedDirectProvider.phase !== "idle" && selectedDirectProvider.phase !== "disconnecting"
      ? (selectedProvider?.service ?? null)
      : null
    : polling
  const selectedProviderProgressLabel = selectedDirectProvider?.phaseLabel
  const cancelSelectedProviderPolling = selectedDirectProvider?.cancel ?? cancelPolling
  const reopenSelectedProviderPolling = selectedDirectProvider?.reopenPolling
  const reopenSelectedProviderPollingLabel = reopenSelectedProviderPolling
    ? selectedDirectProvider?.reopenPollingLabel
    : undefined
  const summaryLoading = busy === "refresh" && !summary
  const listErrorNotice = getConnectionListErrorNotice({ summaryError, detailError: detailErrorNotice?.error ?? null })
  const deleteCachedDetailForService = providerDetail.invalidate

  React.useEffect(() => {
    if (previousViewWorkspaceRef.current === summaryWorkspaceKey) {
      return
    }

    previousViewWorkspaceRef.current = summaryWorkspaceKey
    setView("discover")
    setDiscoveryCategory(null)
    setActiveFilter({ kind: "all" })
    setQuery("")
    setAuthFilter("all")
    setSortMode("recommended")
    setSelectedProviderService(null)
    setNarrowPane("list")
  }, [summaryWorkspaceKey])

  React.useEffect(() => {
    if (detailWorkspaceKeyRef.current === summaryWorkspaceKey) {
      return
    }
    detailWorkspaceKeyRef.current = summaryWorkspaceKey
    connectionActionRequestIdRef.current += 1
    setDialog(null)
    setConfirmDisconnect(null)
    setAccessApp(null)
    handledSelectedAccessAppIdRef.current = null
  }, [summaryWorkspaceKey])

  const accessDialog =
    accessContext && accessApp ? (
      <ConnectionAccessDialog app={accessApp} context={accessContext} open onClose={() => setAccessApp(null)} />
    ) : null

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
    if (!requestedFilter || requestedFilter.kind === "all") {
      return
    }

    setView(
      requestedFilter.kind === "attention" || requestedFilter.kind === "connected" || requestedFilter.kind === "managed"
        ? "manage"
        : "discover",
    )
    setDiscoveryCategory(null)
    setQuery("")
    setActiveFilter(requestedFilter)
  }, [requestedFilter])

  React.useEffect(() => {
    if (!requestedService) {
      return
    }

    setQuery("")
    setDiscoveryCategory(null)
    setActiveFilter({ kind: "all" })
    selectProvider(requestedService)
  }, [requestedService, selectProvider])

  React.useEffect(() => clearDetailCloseTimer, [clearDetailCloseTimer])

  React.useEffect(() => {
    if (showConnectionState) {
      return
    }
    if (activeFilter.kind === "attention") {
      setActiveFilter({ kind: "all" })
    }
  }, [activeFilter.kind, showConnectionState])

  React.useEffect(() => {
    if (!selectedProviderService) {
      return
    }

    if (
      filteredProviders.some((provider) => provider.service === selectedProviderService) ||
      (directProviderByService[selectedProviderService] && !directProviderByService[selectedProviderService].provider)
    ) {
      return
    }

    clearDetailCloseTimer()
    setSelectedProviderService(null)
    setDetailPaneClosing(false)
    setNarrowPane("list")
  }, [clearDetailCloseTimer, directProviderByService, filteredProviders, selectedProviderService])

  const connectProvider = React.useCallback(
    async (
      provider: ConnectionProviderSummary,
      authType: Exclude<ConnectionAuthType, null>,
      appId?: string,
    ): Promise<void> => {
      if (provider.executionMode === "direct") {
        const directProvider = directProviderByService[provider.service]
        if (!directProvider) return
        const ok = await directProvider.connect()
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
      directProviderByService,
      onConnectionReady,
      polling,
      providerDetail,
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
          ? ((await directProviderByService[target.provider.service]?.disconnect()) ?? false)
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
    [connectionActionsEnabled, deleteCachedDetailForService, directProviderByService, disconnect, disconnectAccount],
  )

  if (presentation === "drawer") {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
        {selectedProvider ? (
          <ProviderDetail
            accessContext={accessContext}
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
            onOpenAccess={setAccessApp}
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
        {accessDialog}
      </div>
    )
  }

  return (
    <SplitViewRoot narrowPane={narrowPane}>
      <SplitViewHeader narrowPane={narrowPane} className="oo-border-divider border-b sm:grid-cols-1">
        <div className="grid min-w-0 gap-3">
          <div
            role="tablist"
            aria-label={t("connections.viewSwitcher")}
            className="flex min-w-0 items-center gap-1 border-b"
          >
            <Button
              id="connections-discover-tab"
              type="button"
              role="tab"
              aria-controls="connections-catalog"
              aria-selected={view === "discover"}
              tabIndex={view === "discover" ? 0 : -1}
              variant="ghost"
              size="sm"
              onClick={() => selectView("discover")}
              onKeyDown={handleViewTabKeyDown}
              className={cn(
                "-mb-px h-8 rounded-none border-b-2 border-transparent px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground",
                view === "discover" && "border-foreground text-foreground",
              )}
            >
              {t("connections.discoverConnections")}
            </Button>
            <Button
              id="connections-manage-tab"
              type="button"
              role="tab"
              aria-controls="connections-catalog"
              aria-selected={view === "manage"}
              tabIndex={view === "manage" ? 0 : -1}
              variant="ghost"
              size="sm"
              onClick={() => selectView("manage")}
              onKeyDown={handleViewTabKeyDown}
              className={cn(
                "-mb-px h-8 rounded-none border-b-2 border-transparent px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground",
                view === "manage" && "border-foreground text-foreground",
              )}
            >
              {t("connections.configuredConnections")}
              <span className="oo-text-micro text-muted-foreground tabular-nums">{managedConnectionCount}</span>
            </Button>
          </div>
          <ConnectionListToolbar
            activeFilter={activeFilter}
            authFilter={authFilter}
            attentionCount={attentionCount}
            availableToolsCount={discoveryCategory ? discoveryAvailableToolsCount : availableToolsCount}
            connectedCount={discoveryCategory ? discoveryConnectedCount : connectedCount}
            directlyAvailableCount={discoveryCategory ? discoveryDirectlyAvailableCount : directlyAvailableCount}
            loading={summaryLoading}
            managedConnectionCount={managedConnectionCount}
            query={query}
            resultCount={filteredProviders.length}
            searchPlaceholder={
              discoveryCategoryTitle
                ? t("connections.searchCategoryProviders", { category: discoveryCategoryTitle })
                : t("connections.searchProviders")
            }
            showConnectionState={showConnectionState}
            sortMode={sortMode}
            totalCount={discoveryProviderCount ?? providers.length}
            view={view}
            onFilterChange={setActiveFilter}
            onAuthFilterChange={setAuthFilter}
            onQueryChange={setQuery}
            onReset={() => {
              setQuery("")
              setAuthFilter("all")
              setSortMode("recommended")
              setActiveFilter(view === "manage" ? { kind: "managed" } : { kind: "all" })
            }}
            onSortModeChange={setSortMode}
          />
        </div>
      </SplitViewHeader>

      <SplitViewBody
        desktopLayout={selectedProvider ? "default" : "single"}
        className="motion-reduce:transition-none min-[960px]:transition-[grid-template-columns] min-[960px]:duration-200 min-[960px]:ease-out"
      >
        <SplitViewListPane
          id="connections-catalog"
          role="tabpanel"
          aria-labelledby={view === "manage" ? "connections-manage-tab" : "connections-discover-tab"}
          ref={listPaneRef}
          narrowPane={narrowPane}
          className="pt-3"
        >
          <div className="grid gap-3">
            {view === "discover" && discoveryCategory ? (
              <ConnectionDiscoveryCategoryHeader
                category={discoveryCategory}
                providerCount={discoveryProviderCount ?? 0}
                onBack={leaveDiscoveryCategory}
              />
            ) : null}
            {view === "discover" && !discoveryCategory && !selectedProvider && !normalizedQuery ? (
              <ConnectionScenarioShowcase providers={catalogProviders} onSelect={selectScenario} />
            ) : null}
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
              <EmptyList
                summary={summary}
                hasQuery={Boolean(normalizedQuery)}
                onDiscover={
                  view === "manage" && activeFilter.kind === "managed" && authFilter === "all" && !normalizedQuery
                    ? () => selectView("discover")
                    : undefined
                }
              />
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

        {selectedProvider && !desktopSplitView ? (
          <SplitViewMobileDetailPane narrowPane={narrowPane}>
            <div className="mb-2">
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                <ArrowLeft className="size-4" />
                {t("connections.backToProviders")}
              </Button>
            </div>
            <ProviderDetail
              accessContext={accessContext}
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
              onOpenAccess={setAccessApp}
              onReopenPolling={reopenSelectedProviderPolling}
              polling={selectedProviderPolling}
              progressLabel={selectedProviderProgressLabel}
              reopenPollingLabel={reopenSelectedProviderPollingLabel}
              provider={selectedProvider}
            />
          </SplitViewMobileDetailPane>
        ) : null}

        {selectedProvider && desktopSplitView ? (
          <SplitViewDesktopDetailPane
            className={cn(
              "pt-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
              detailPaneClosing
                ? "pointer-events-none translate-x-2 opacity-0"
                : "translate-x-0 animate-in opacity-100 fade-in-0 slide-in-from-right-2 motion-reduce:animate-none",
            )}
          >
            <ProviderDetail
              accessContext={accessContext}
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
              onOpenAccess={setAccessApp}
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
      {accessDialog}
    </SplitViewRoot>
  )
}
