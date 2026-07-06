import type {
  ConnectionAuthType,
  ConnectionConnectInput,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionUserOAuthClientConfigSummary,
} from "../../../electron/connections/common.ts"
import type { ConnectionCatalogFilter, ConnectionCategoryFilter, DisconnectTarget } from "./connection-route-model.ts"
import type { ConnectionAuthIntent } from "./ConnectionProviderDetailPane.tsx"
import type { UseConnections } from "@/hooks/useConnections"
import type { UserFacingError } from "@/lib/user-facing-error"

import { ArrowLeft, ChevronDown, X } from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { getConnectionDetailErrorNotice, getConnectionListErrorNotice } from "./connection-error-display.ts"
import { compareConnectionProvidersByRecommendation } from "./connection-provider-ranking.ts"
import {
  buildCategoryFilters,
  categoryFilterLimit,
  categoryFilterPrefix,
  detailPaneAnimationMs,
  getFilterValue,
  getProviderActionLabel,
  getProviderMeta,
  getProviderStatusDisplayLabel,
  getProviderStatusTone,
  isConnected,
  matchesProviderFilter,
  matchesProviderQuery,
  parseFilterValue,
} from "./connection-route-model.ts"
import { EmptyList, ProviderDetail, StatusNotice } from "./ConnectionProviderDetailPane.tsx"
import { DisconnectDialog } from "./DisconnectDialog.tsx"
import { shouldOpenOAuthClientDialog } from "./oauth-client-config.ts"
import {
  getProviderGridColumnCount,
  getProviderGridVisibleRange,
  providerGridCardHeightPx,
  providerGridGapPx,
} from "./provider-grid-virtualization.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SplitViewBody,
  SplitViewDesktopDetailPane,
  SplitViewHeader,
  SplitViewListPane,
  SplitViewMobileDetailPane,
  SplitViewRoot,
} from "@/components/ui/split-view"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { getOAuthClientConfig } from "@/lib/connections-client"
import { resolveConnectionError } from "@/lib/connections-error"
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
    getProviderDetail,
    polling,
    summary,
    summaryError,
  } = connections
  const [query, setQuery] = React.useState("")
  const [activeFilter, setActiveFilter] = React.useState<ConnectionCatalogFilter>({ kind: "all" })
  const [selectedProviderService, setSelectedProviderService] = React.useState<string | null>(null)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const [detail, setDetail] = React.useState<ConnectionProviderDetail | null>(null)
  const [detailService, setDetailService] = React.useState<string | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<UserFacingError | null>(null)
  const [detailPaneClosing, setDetailPaneClosing] = React.useState(false)
  const [dialog, setDialog] = React.useState<{
    appId?: string
    authType: "api_key" | "custom_credential" | "federated" | "oauth2"
    detail: ConnectionProviderDetail
    oauthClientConfig?: ConnectionUserOAuthClientConfigSummary | null
  } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<DisconnectTarget | null>(null)
  const detailCloseTimerRef = React.useRef<number | null>(null)
  const detailCacheRef = React.useRef<Map<string, ConnectionProviderDetail>>(new Map())
  const detailRequestIdRef = React.useRef(0)
  const listPaneRef = React.useRef<HTMLDivElement | null>(null)

  const providers = summary?.providers ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const categoryFilters = React.useMemo(() => buildCategoryFilters(providers, t), [providers, t])
  const connectedCount = React.useMemo(() => providers.filter(isConnected).length, [providers])
  const attentionCount = React.useMemo(
    () => providers.filter((provider) => provider.status === "needs_attention").length,
    [providers],
  )
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
  const selectedDetailService = selectedProvider?.service ?? null
  const detailErrorNotice = selectedProvider ? getConnectionDetailErrorNotice({ actionError, detailError }) : null
  const listErrorNotice = getConnectionListErrorNotice({
    summaryError,
    detailError: detailErrorNotice?.error ?? null,
  })

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

  React.useEffect(() => {
    if (!selectedDetailService) {
      detailRequestIdRef.current += 1
      setDetail(null)
      setDetailService(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }

    let cancelled = false
    const requestId = detailRequestIdRef.current + 1
    detailRequestIdRef.current = requestId
    const cached = detailCacheRef.current.get(selectedDetailService)
    if (cached) {
      setDetail(cached)
      setDetailService(selectedDetailService)
      setDetailError(null)
      setDetailLoading(false)
      return
    }

    setDetailLoading(true)
    setDetailError(null)
    void getProviderDetail(selectedDetailService)
      .then((next) => {
        if (!cancelled && detailRequestIdRef.current === requestId) {
          detailCacheRef.current.set(selectedDetailService, next)
          setDetail(next)
          setDetailService(selectedDetailService)
        }
      })
      .catch((err) => {
        if (!cancelled && detailRequestIdRef.current === requestId) {
          setDetail(null)
          setDetailService(null)
          setDetailError(resolveConnectionError(err, "detail"))
        }
      })
      .finally(() => {
        if (!cancelled && detailRequestIdRef.current === requestId) {
          setDetailLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [getProviderDetail, selectedDetailService])

  const connectProvider = React.useCallback(
    async (
      provider: ConnectionProviderSummary,
      authType: Exclude<ConnectionAuthType, null>,
      appId?: string,
    ): Promise<void> => {
      try {
        if (authType === "oauth2") {
          const loaded =
            detailService === provider.service && detail ? detail : await getProviderDetail(provider.service)
          const oauthClientConfig = loaded.oauthClientConfig ? await getOAuthClientConfig(provider.service) : null
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
          if (ok) {
            detailCacheRef.current.delete(provider.service)
          }
          return
        }

        if (authType === "no_auth") {
          const ok = await connect({ authType, service: provider.service })
          if (ok) {
            detailCacheRef.current.delete(provider.service)
          }
          return
        }

        const loaded = detailService === provider.service && detail ? detail : await getProviderDetail(provider.service)
        setDialog({ detail: loaded, authType, appId })
      } catch (err) {
        setDetailError(resolveConnectionError(err, "detail"))
      }
    },
    [connect, detail, detailService, getProviderDetail],
  )

  const submitConnectDialog = React.useCallback(
    (input: ConnectionConnectInput): void => {
      void (async () => {
        const ok = await connect(input)
        if (ok) {
          detailCacheRef.current.delete(input.service)
          setDialog(null)
        }
      })()
      if (input.authType === "oauth2") {
        setDialog(null)
      }
    },
    [connect],
  )

  if (presentation === "drawer") {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
        {selectedProvider ? (
          <ProviderDetail
            authIntent={authIntent?.service === selectedProvider.service ? authIntent : null}
            busy={busy}
            detail={detailService === selectedProvider.service ? detail : null}
            errorNotice={detailErrorNotice}
            detailLoading={detailLoading}
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
            <div className="oo-text-caption oo-text-muted">
              {summaryError ? userFacingErrorDescription(summaryError, t) : t("connections.drawerLoading")}
            </div>
          </section>
        )}
        <ConnectDialog
          open={dialog !== null}
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
              detailCacheRef.current.delete(target.provider.service)
              if (detailService === target.provider.service) {
                setDetail(null)
                setDetailService(null)
              }
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
            {filteredProviders.length === 0 ? (
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
              detail={detailService === selectedProvider.service ? detail : null}
              errorNotice={detailErrorNotice}
              detailLoading={detailLoading}
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
              detail={detailService === selectedProvider.service ? detail : null}
              errorNotice={detailErrorNotice}
              detailLoading={detailLoading}
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
            detailCacheRef.current.delete(target.provider.service)
            if (detailService === target.provider.service) {
              setDetail(null)
              setDetailService(null)
            }
            setConfirmDisconnect(null)
          }
        }}
      />
    </SplitViewRoot>
  )
}

function ConnectionListToolbar({
  activeFilter,
  attentionCount,
  categoryFilters,
  connectedCount,
  onFilterChange,
  onQueryChange,
  query,
  totalCount,
}: {
  activeFilter: ConnectionCatalogFilter
  attentionCount: number
  categoryFilters: ConnectionCategoryFilter[]
  connectedCount: number
  onFilterChange: (filter: ConnectionCatalogFilter) => void
  onQueryChange: (query: string) => void
  query: string
  totalCount: number
}) {
  const t = useT()
  const selectedCategory = activeFilter.kind === "category" ? activeFilter.category : null
  const topCategoryFilters = categoryFilters.slice(0, categoryFilterLimit)
  const selectedCategoryFilter = selectedCategory
    ? categoryFilters.find((filter) => filter.label === selectedCategory)
    : undefined
  const visibleCategoryFilters =
    selectedCategoryFilter && !topCategoryFilters.some((filter) => filter.label === selectedCategoryFilter.label)
      ? [...topCategoryFilters, selectedCategoryFilter]
      : topCategoryFilters
  const overflowCategoryFilters = categoryFilters.filter(
    (filter) => !visibleCategoryFilters.some((visibleFilter) => visibleFilter.label === filter.label),
  )
  const filterValue = getFilterValue(activeFilter)

  return (
    <div className="grid w-full min-w-0 gap-2">
      <SearchField
        value={query}
        placeholder={t("connections.search")}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
        <div className="oo-connection-filter-row flex min-w-0 items-center overflow-x-auto overflow-y-hidden">
          <ToggleGroup
            type="single"
            variant="default"
            size="sm"
            spacing={1}
            value={filterValue}
            aria-label={t("connections.catalogView")}
            className="flex min-w-max flex-nowrap gap-1"
            onValueChange={(nextValue) => {
              const nextFilter = parseFilterValue(nextValue)
              if (nextFilter) {
                onFilterChange(nextFilter)
              }
            }}
          >
            <FilterToggleItem count={totalCount} label={t("connections.filterAll")} value="all" />
            <FilterToggleItem count={connectedCount} label={t("connections.filterConnected")} value="connected" />
            <FilterToggleItem count={attentionCount} label={t("connections.needsAttention")} value="attention" />
            {visibleCategoryFilters.map((filter) => (
              <FilterToggleItem
                key={filter.label}
                count={filter.count}
                label={filter.displayLabel}
                value={`${categoryFilterPrefix}${filter.label}`}
              />
            ))}
          </ToggleGroup>
        </div>
        {overflowCategoryFilters.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-md transition-[background-color,border-color,box-shadow,transform] active:translate-y-px data-[state=open]:border-[var(--accent-ring)] data-[state=open]:bg-[var(--accent-soft)] data-[state=open]:text-foreground data-[state=open]:shadow-[inset_0_0_0_1px_var(--accent-ring)]"
              >
                {t("connections.moreCategories")}
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56">
              <DropdownMenuLabel>{t("connections.category")}</DropdownMenuLabel>
              {overflowCategoryFilters.map((filter) => (
                <DropdownMenuItem
                  key={filter.label}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
                  onSelect={() => onFilterChange({ kind: "category", category: filter.label })}
                >
                  <span className="truncate">{filter.displayLabel}</span>
                  <span className="oo-text-muted">{filter.count}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}

function FilterToggleItem({ count, label, value }: { count: number; label: string; value: string }) {
  return (
    <ToggleGroupItem
      value={value}
      className="group/filter max-w-48 cursor-pointer gap-1.5 rounded-md border border-[var(--oo-control-border)] px-2.5 transition-[background-color,border-color,color,box-shadow,transform] hover:border-[var(--selection-ring)] active:translate-y-px active:scale-[0.98] data-[state=on]:!border-[var(--accent-ring)] data-[state=on]:!bg-[var(--accent-soft)] data-[state=on]:!text-foreground data-[state=on]:!shadow-[inset_0_0_0_1px_var(--accent-ring)] data-[state=on]:hover:!bg-[var(--accent-soft)]"
    >
      <span className="truncate">{label}</span>
      <span className="oo-text-micro oo-text-muted transition-colors group-data-[state=on]/filter:text-[var(--accent-strong)]">
        {count}
      </span>
    </ToggleGroupItem>
  )
}

function ProviderCatalog({
  providers,
  scrollParentRef,
  selectedService,
  onSelect,
}: {
  onSelect: (provider: ConnectionProviderSummary) => void
  providers: ConnectionProviderSummary[]
  scrollParentRef: React.RefObject<HTMLDivElement | null>
  selectedService: string | null
}) {
  return (
    <ProviderGrid
      providers={providers}
      scrollParentRef={scrollParentRef}
      selectedService={selectedService}
      onSelect={onSelect}
    />
  )
}

function ProviderGrid({
  providers,
  scrollParentRef,
  selectedService,
  onSelect,
}: {
  onSelect: (provider: ConnectionProviderSummary) => void
  providers: ConnectionProviderSummary[]
  scrollParentRef: React.RefObject<HTMLDivElement | null>
  selectedService: string | null
}) {
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const updateFrameRef = React.useRef<number | null>(null)
  const [viewport, setViewport] = React.useState({
    catalogTop: 0,
    scrollTop: 0,
    viewportHeight: 0,
    width: 0,
  })

  const updateViewport = React.useCallback(() => {
    const grid = gridRef.current
    const scrollParent = scrollParentRef.current
    if (!grid || !scrollParent) {
      return
    }

    const gridRect = grid.getBoundingClientRect()
    const parentRect = scrollParent.getBoundingClientRect()
    const nextViewport = {
      catalogTop: gridRect.top - parentRect.top + scrollParent.scrollTop,
      scrollTop: scrollParent.scrollTop,
      viewportHeight: scrollParent.clientHeight,
      width: grid.clientWidth,
    }

    setViewport((current) =>
      current.catalogTop === nextViewport.catalogTop &&
      current.scrollTop === nextViewport.scrollTop &&
      current.viewportHeight === nextViewport.viewportHeight &&
      current.width === nextViewport.width
        ? current
        : nextViewport,
    )
  }, [scrollParentRef])

  const scheduleViewportUpdate = React.useCallback(() => {
    if (updateFrameRef.current !== null) {
      return
    }

    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null
      updateViewport()
    })
  }, [updateViewport])

  React.useLayoutEffect(() => {
    updateViewport()
  }, [providers.length, updateViewport])

  React.useEffect(() => {
    const grid = gridRef.current
    const scrollParent = scrollParentRef.current
    if (!grid || !scrollParent) {
      return
    }

    const resizeObserver = new ResizeObserver(scheduleViewportUpdate)
    resizeObserver.observe(grid)
    resizeObserver.observe(scrollParent)
    scrollParent.addEventListener("scroll", scheduleViewportUpdate, { passive: true })
    scheduleViewportUpdate()

    return () => {
      resizeObserver.disconnect()
      scrollParent.removeEventListener("scroll", scheduleViewportUpdate)
      if (updateFrameRef.current !== null) {
        window.cancelAnimationFrame(updateFrameRef.current)
        updateFrameRef.current = null
      }
    }
  }, [scheduleViewportUpdate, scrollParentRef])

  const columnCount = React.useMemo(() => getProviderGridColumnCount(viewport.width), [viewport.width])
  const visibleRange = React.useMemo(
    () =>
      getProviderGridVisibleRange({
        catalogTop: viewport.catalogTop,
        columnCount,
        providerCount: providers.length,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.viewportHeight,
      }),
    [columnCount, providers.length, viewport.catalogTop, viewport.scrollTop, viewport.viewportHeight],
  )
  const visibleProviders = React.useMemo(
    () => providers.slice(visibleRange.startIndex, visibleRange.endIndex),
    [providers, visibleRange.endIndex, visibleRange.startIndex],
  )

  return (
    <div ref={gridRef} className="relative" style={{ height: visibleRange.totalHeight }}>
      <div
        className="absolute inset-x-0 top-0 grid will-change-transform"
        style={{
          gap: providerGridGapPx,
          gridTemplateColumns: "repeat(auto-fill, minmax(13.5rem, 1fr))",
          transform: `translateY(${visibleRange.topOffset}px)`,
        }}
      >
        {visibleProviders.map((provider) => (
          <ProviderCard
            key={provider.service}
            provider={provider}
            selected={provider.service === selectedService}
            onSelect={() => onSelect(provider)}
          />
        ))}
      </div>
    </div>
  )
}

function ProviderCard({
  provider,
  selected,
  onSelect,
}: {
  provider: ConnectionProviderSummary
  selected: boolean
  onSelect: () => void
}) {
  const t = useT()
  const tone = getProviderStatusTone(provider)
  const statusLabel = getProviderStatusDisplayLabel(provider, t)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group/card relative grid min-w-0 cursor-pointer overflow-hidden rounded-md border bg-card px-2.5 py-1.5 text-left text-card-foreground transition-[background-color,border-color,box-shadow,transform] outline-none hover:border-[var(--selection-ring)] hover:bg-[var(--oo-row-hover)] focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px",
        selected &&
          "border-[var(--accent-ring)] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent-ring)] before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-[var(--accent-strong)] hover:bg-[var(--accent-soft)]",
      )}
      style={{ height: providerGridCardHeightPx }}
    >
      <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} />
        <span className="grid min-w-0 gap-0.5">
          <span className="oo-text-control truncate font-medium">{provider.displayName}</span>
          <span className="oo-text-micro oo-text-muted truncate">{getProviderMeta(provider, t)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5" title={statusLabel}>
          <span
            aria-label={statusLabel}
            className={cn(
              "size-1.5 rounded-full",
              tone === "connected" && "bg-[var(--success)]",
              tone === "attention" && "bg-[var(--warning)]",
              tone === "available" && "bg-muted-foreground/40",
            )}
          />
          <span className="oo-text-micro max-w-16 truncate font-medium text-muted-foreground">
            {getProviderActionLabel(provider, t)}
          </span>
        </span>
      </span>
    </button>
  )
}
