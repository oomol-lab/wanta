import type {
  ConnectionAuthType,
  ConnectionAppSummary,
  ConnectionConnectInput,
  ConnectionExecutionLogSummary,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionSummary,
  ConnectionUsageDailyPoint,
  ConnectionUsageServiceItem,
} from "../../../electron/connections/common.ts"
import type { ConnectionErrorNotice } from "./connection-error-display.ts"
import type { UseConnections } from "@/hooks/useConnections"
import type { MessageKey, TranslateFn } from "@/i18n/i18n"
import type { UserFacingError } from "@/lib/user-facing-error"

import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plug,
  RefreshCw,
  Star,
  Unplug,
  X,
} from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { getConnectionDetailErrorNotice, getConnectionListErrorNotice } from "./connection-error-display.ts"
import {
  getProviderGridColumnCount,
  getProviderGridVisibleRange,
  providerGridCardHeightPx,
  providerGridGapPx,
} from "./provider-grid-virtualization.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { authTypeLabel } from "./shared.ts"
import { Loader } from "@/components/ai-elements/loader"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
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
import { resolveConnectionError } from "@/lib/connections-error"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

const executionLogLimit = 12
const detailPaneAnimationMs = 150
const categoryFilterLimit = 4
const accountActionButtonClassName = "h-7 gap-1.5 px-2"
const categoryFilterPrefix = "category:"
const uncategorizedCategoryValue = "__uncategorized__"
const categoryMessageKeysByRawLabel: Record<string, MessageKey> = {
  AI: "connections.category.ai",
  Communication: "connections.category.communication",
  "Data & Analytics": "connections.category.dataAnalytics",
  "Design & Media": "connections.category.designMedia",
  "Developer Tools": "connections.category.developerTools",
  Documentation: "connections.category.documentation",
  Efficiency: "connections.category.efficiency",
  Finance: "connections.category.finance",
  "Maps & Location": "connections.category.mapsLocation",
  Marketing: "connections.category.marketing",
  Productivity: "connections.category.productivity",
  "Security & Identity": "connections.category.securityIdentity",
  Social: "connections.category.social",
  Storage: "connections.category.storage",
}

type ConnectionCatalogFilter =
  | { kind: "all" }
  | { kind: "attention" }
  | { kind: "category"; category: string }
  | { kind: "connected" }

interface ConnectionCategoryFilter {
  count: number
  displayLabel: string
  label: string
}

interface DisconnectTarget {
  app?: ConnectionAppSummary
  provider: ConnectionProviderSummary
}

function isConnected(provider: ConnectionProviderSummary): boolean {
  return provider.status === "connected" && provider.appStatus === "active"
}

function getProviderStatusTone(provider: ConnectionProviderSummary): "attention" | "available" | "connected" {
  if (provider.status === "needs_attention") {
    return "attention"
  }
  if (provider.status === "connected") {
    return "connected"
  }
  return "available"
}

function getProviderStatusLabel(provider: ConnectionProviderSummary, t: ReturnType<typeof useT>): string | null {
  switch (provider.status) {
    case "needs_attention":
      return t("connections.providerNeedsAttention")
    case "available":
      return t("connections.providerAvailable")
    case "connected":
      return null
  }
}

function getDefaultAuthType(provider: ConnectionProviderSummary): Exclude<ConnectionAuthType, null> | null {
  if (provider.appAuthType && provider.authTypes.includes(provider.appAuthType)) {
    return provider.appAuthType
  }
  return provider.authTypes[0] ?? null
}

function formatAuthTypes(authTypes: Exclude<ConnectionAuthType, null>[], t: ReturnType<typeof useT>): string {
  if (authTypes.length === 0) {
    return t("connections.authUnknown")
  }
  return authTypes.map((authType) => authTypeLabel(t, authType)).join(" / ")
}

function isConnectionAuthType(
  value: string,
  authTypes: Exclude<ConnectionAuthType, null>[],
): value is Exclude<ConnectionAuthType, null> {
  return authTypes.some((authType) => authType === value)
}

function formatDateTime(value: number | string | undefined, t: ReturnType<typeof useT>): string {
  if (!value) {
    return t("connections.notConnected")
  }

  const date = typeof value === "number" ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return t("connections.executionTimeUnknown")
  }

  return date.toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  })
}

function formatUsageDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" })
}

function formatDuration(durationMs: number | null, t: ReturnType<typeof useT>): string {
  if (durationMs === null) {
    return t("connections.executionDurationUnknown")
  }
  if (durationMs < 1000) {
    return t("connections.executionDurationMs", { value: durationMs })
  }
  return t("connections.executionDurationSeconds", {
    value: Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(durationMs / 1000),
  })
}

function getProviderDescription(provider: ConnectionProviderSummary, t: ReturnType<typeof useT>): string {
  switch (provider.status) {
    case "needs_attention":
      return t("connections.providerNeedsAttentionDescription", { name: provider.displayName })
    case "connected":
      if (provider.appCount > 1) {
        return t("connections.connectionCount", { count: provider.appCount })
      }
      return provider.accountLabel && provider.accountLabel !== provider.displayName
        ? provider.accountLabel
        : getProviderCategoryLabel(provider, t)
    case "available":
      return getProviderCategoryLabel(provider, t)
  }
}

function getEmptyState(
  summary: ConnectionSummary | null,
  t: ReturnType<typeof useT>,
): { description: string; title: string } {
  if (!summary) {
    return { title: t("connections.unavailableTitle"), description: t("connections.unavailableDescription") }
  }

  switch (summary.status) {
    case "signed-out":
      return { title: t("connections.signedOutTitle"), description: t("connections.signedOutDescription") }
    case "unavailable":
      return { title: t("connections.unavailableTitle"), description: t("connections.unavailableDescription") }
    case "ready":
      return { title: t("connections.emptyTitle"), description: t("connections.readyEmptyDescription") }
  }
}

function authTypeNeedsDialog(authType: Exclude<ConnectionAuthType, null>): boolean {
  return authType === "api_key" || authType === "custom_credential" || authType === "federated"
}

function getProviderStatusDisplayLabel(provider: ConnectionProviderSummary, t: ReturnType<typeof useT>): string {
  return getProviderStatusLabel(provider, t) ?? t("connections.connected")
}

function getProviderActionLabel(provider: ConnectionProviderSummary, t: ReturnType<typeof useT>): string {
  if (provider.actionKind === "unavailable") {
    return t("connections.unsupported")
  }
  switch (provider.status) {
    case "needs_attention":
      return t("connections.reconnect")
    case "connected":
      return t("connections.manage")
    case "available":
      return t("connections.connect")
  }
}

function getCategoryDisplayLabel(label: string, t: TranslateFn): string {
  if (label === uncategorizedCategoryValue) {
    return t("connections.categoryUnknown")
  }
  const key = categoryMessageKeysByRawLabel[label]
  return key ? t(key) : label
}

function getProviderCategoryRawLabels(provider: ConnectionProviderSummary): string[] {
  return provider.categoryLabels.length > 0 ? provider.categoryLabels : [uncategorizedCategoryValue]
}

function getProviderCategoryLabel(provider: ConnectionProviderSummary, t: TranslateFn): string {
  return getCategoryDisplayLabel(getProviderCategoryRawLabels(provider)[0] ?? uncategorizedCategoryValue, t)
}

function formatProviderCategoryLabels(provider: ConnectionProviderSummary, t: TranslateFn): string {
  return getProviderCategoryRawLabels(provider)
    .map((label) => getCategoryDisplayLabel(label, t))
    .join(" / ")
}

function getProviderMeta(provider: ConnectionProviderSummary, t: ReturnType<typeof useT>): string {
  if (provider.status === "connected" && provider.appCount > 1) {
    return t("connections.connectionCount", { count: provider.appCount })
  }
  return provider.accountLabel ?? getProviderCategoryLabel(provider, t)
}

function getConnectionAppDisplayName(app: ConnectionAppSummary): string {
  return app.displayName || app.alias || app.accountLabel || app.providerAccountId || app.id
}

function getConnectionAppSecondaryLabel(app: ConnectionAppSummary): string | null {
  const primary = getConnectionAppDisplayName(app)
  const account = app.accountLabel || app.providerAccountId
  if (!account || account === primary) {
    return null
  }
  return account
}

function matchesProviderQuery(provider: ConnectionProviderSummary, normalizedQuery: string, t: TranslateFn): boolean {
  if (!normalizedQuery) {
    return true
  }
  return (
    provider.displayName.toLowerCase().includes(normalizedQuery) ||
    provider.service.toLowerCase().includes(normalizedQuery) ||
    getProviderCategoryRawLabels(provider).some((label) => {
      return (
        label.toLowerCase().includes(normalizedQuery) ||
        getCategoryDisplayLabel(label, t).toLowerCase().includes(normalizedQuery)
      )
    }) ||
    provider.accountLabel?.toLowerCase().includes(normalizedQuery) === true ||
    provider.apps.some((app) => {
      return (
        getConnectionAppDisplayName(app).toLowerCase().includes(normalizedQuery) ||
        app.accountLabel?.toLowerCase().includes(normalizedQuery) === true ||
        app.providerAccountId?.toLowerCase().includes(normalizedQuery) === true
      )
    })
  )
}

function getFilterValue(filter: ConnectionCatalogFilter): string {
  return filter.kind === "category" ? `${categoryFilterPrefix}${filter.category}` : filter.kind
}

function parseFilterValue(value: string): ConnectionCatalogFilter | null {
  if (value === "all" || value === "connected" || value === "attention") {
    return { kind: value }
  }
  if (value.startsWith(categoryFilterPrefix)) {
    const category = value.slice(categoryFilterPrefix.length)
    return category ? { kind: "category", category } : null
  }
  return null
}

function buildCategoryFilters(
  providers: ConnectionProviderSummary[],
  t: ReturnType<typeof useT>,
): ConnectionCategoryFilter[] {
  const countByCategory = new Map<string, number>()
  for (const provider of providers) {
    for (const label of getProviderCategoryRawLabels(provider)) {
      countByCategory.set(label, (countByCategory.get(label) ?? 0) + 1)
    }
  }

  return [...countByCategory.entries()]
    .map(([label, count]) => ({ count, displayLabel: getCategoryDisplayLabel(label, t), label }))
    .sort((left, right) => right.count - left.count || left.displayLabel.localeCompare(right.displayLabel))
}

function matchesProviderFilter(provider: ConnectionProviderSummary, filter: ConnectionCatalogFilter): boolean {
  switch (filter.kind) {
    case "all":
      return true
    case "connected":
      return isConnected(provider)
    case "attention":
      return provider.status === "needs_attention"
    case "category":
      return getProviderCategoryRawLabels(provider).includes(filter.category)
  }
}

interface ConnectionsPanelProps {
  authIntent?: ConnectionAuthIntent | null
  connections: UseConnections
  onClose?: () => void
  presentation?: "drawer" | "page"
  selectedService?: string | null
}

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
    authType: "api_key" | "custom_credential" | "federated"
    detail: ConnectionProviderDetail
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
    return catalogProviders.filter((provider) => matchesProviderQuery(provider, normalizedQuery, t))
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
        if (authType === "oauth2" || authType === "no_auth") {
          const input: ConnectionConnectInput =
            authType === "oauth2"
              ? { authType, service: provider.service, appId }
              : { authType, service: provider.service }
          const ok = await connect(input)
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
          busy={busy === "connect"}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const ok = await connect(input)
            if (ok) {
              detailCacheRef.current.delete(input.service)
              setDialog(null)
            }
          }}
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
        busy={busy === "connect"}
        onClose={() => setDialog(null)}
        onSubmit={async (input) => {
          const ok = await connect(input)
          if (ok) {
            detailCacheRef.current.delete(input.service)
            setDialog(null)
          }
        }}
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
        <div className="oo-connection-filter-row min-w-0 overflow-x-auto overflow-y-hidden pb-0.5">
          <ToggleGroup
            type="single"
            variant="outline"
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
              <Button variant="outline" size="sm" className="gap-1.5 rounded-md">
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
    <ToggleGroupItem value={value} className="max-w-48 gap-1.5 rounded-md border px-2.5">
      <span className="truncate">{label}</span>
      <span className="oo-text-micro oo-text-muted">{count}</span>
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
        "grid min-w-0 rounded-md border bg-card px-2.5 py-1.5 text-left text-card-foreground transition-colors outline-none hover:bg-[var(--oo-row-hover)] focus-visible:ring-[3px] focus-visible:ring-ring/40",
        selected && "border-ring bg-accent/55",
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

function ProviderStatusBadge({ provider }: { provider: ConnectionProviderSummary }) {
  const t = useT()
  const tone = getProviderStatusTone(provider)
  return (
    <Badge variant={tone === "connected" ? "success" : tone === "attention" ? "warning" : "muted"}>
      {getProviderStatusDisplayLabel(provider, t)}
    </Badge>
  )
}

function StatusNotice({ summary }: { summary: ConnectionSummary }) {
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

function EmptyList({ summary, hasQuery }: { summary: ConnectionSummary | null; hasQuery: boolean }) {
  const t = useT()
  const state = getEmptyState(summary, t)
  return (
    <section className="grid gap-1 rounded-lg border bg-muted/30 px-3 py-3">
      <div className="oo-text-label">{hasQuery ? t("connections.emptySearch") : state.title}</div>
      <div className="oo-text-caption oo-text-muted">{hasQuery ? t("connections.noMatch") : state.description}</div>
    </section>
  )
}

function ProviderDetail({
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
        <ConnectionPanel
          authIntent={authIntent}
          busy={busy}
          canSetDefault={summary?.workspace.type !== "organization"}
          connections={connections}
          currentAuthType={currentAuthType}
          detail={detail}
          detailLoading={detailLoading}
          onCancelPolling={onCancelPolling}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          polling={polling}
          provider={provider}
        />
      </section>

      {isConnected(provider) ? (
        <ProviderUsagePanel
          connections={connections}
          provider={provider}
          usage={usage}
          usageDays={summary?.usage.days ?? 7}
        />
      ) : null}

      <section className="grid gap-1.5">
        <h3 className="oo-text-title px-0.5">{t("connections.providerDetails")}</h3>
        <dl className="overflow-hidden rounded-md border">
          <DetailRow
            label={t("connections.account")}
            value={
              provider.appCount > 1
                ? t("connections.connectionCount", { count: provider.appCount })
                : (provider.accountLabel ?? t("connections.notConnected"))
            }
          />
          <DetailRow label={t("connections.auth")} value={formatAuthTypes(provider.authTypes, t)} />
          <DetailRow label={t("connections.category")} value={formatProviderCategoryLabels(provider, t)} />
          <DetailRow label={t("connections.service")} value={provider.service} mono />
          <DetailRow label={t("connections.updatedAt")} value={formatDateTime(provider.connectedUpdatedAt, t)} />
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
  const isPolling = polling === provider.service

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
        <AuthTypeToggleGroup
          authTypes={usableAuthTypes}
          value={activeAuthType ?? null}
          onChange={setSelectedAuthType}
        />
      </div>

      {activeAuthType ? (
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

      {provider.apps.length > 0 ? (
        <ConnectionAccountsList
          busy={busy}
          canSetDefault={canSetDefault}
          connections={connections}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          provider={provider}
        />
      ) : null}
    </div>
  )
}

function ConnectionAccountsList({
  busy,
  canSetDefault,
  connections,
  onConnect,
  onDisconnect,
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
      {provider.apps.map((app) => {
        const reconnectAuthType =
          app.authType && app.authType !== "no_auth" && isConnectionAuthType(app.authType, provider.authTypes)
            ? app.authType
            : null
        const secondaryLabel = getConnectionAppSecondaryLabel(app)
        const authLabel = app.authType ? authTypeLabel(t, app.authType) : t("connections.authUnknown")
        return (
          <article
            key={app.id}
            className="grid min-w-0 gap-2.5 rounded-md border bg-card px-3 py-2.5 text-card-foreground"
          >
            <div className="grid min-w-0 gap-1">
              <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                <span className="oo-text-control max-w-full min-w-0 font-medium break-all">
                  {getConnectionAppDisplayName(app)}
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {app.isDefault ? <Badge variant="success">{t("connections.defaultConnection")}</Badge> : null}
                  {app.status === "reauth_required" || app.status === "error" ? (
                    <Badge variant="warning">{t("connections.providerNeedsAttention")}</Badge>
                  ) : null}
                </span>
              </div>
              <div className="oo-text-micro oo-text-muted flex min-w-0 flex-wrap items-center gap-1.5">
                {secondaryLabel ? <span className="max-w-full min-w-0 break-all">{secondaryLabel}</span> : null}
                {secondaryLabel ? <span className="h-3 w-px shrink-0 bg-border" /> : null}
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
                  disabled={busy === "connect"}
                  onClick={() => void onConnect(provider, reconnectAuthType, app.id)}
                >
                  <KeyRound className="size-3.5" />
                  {t("connections.reconnect")}
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

function AuthTypeToggleGroup({
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

function ProviderUsagePanel({
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
    if (isUsageDialogOpen && providerUsage.calls > 0 && !logs && !loading) {
      void loadLogs()
    }
  }, [isUsageDialogOpen, loadLogs, loading, logs, providerUsage.calls])

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

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] border-b px-2.5 py-1.5 last:border-b-0">
      <dt className="oo-text-caption oo-text-muted">{label}</dt>
      <dd className={cn("oo-text-control min-w-0 truncate", mono && "font-mono")}>{value}</dd>
    </div>
  )
}

function DisconnectDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: DisconnectTarget | null
  busy: boolean
  onClose: () => void
  onConfirm: (target: DisconnectTarget) => void
}) {
  const t = useT()
  if (!target) {
    return null
  }

  const { app, provider } = target
  const displayName = app ? `${provider.displayName} · ${getConnectionAppDisplayName(app)}` : provider.displayName

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={t("connections.confirmDisconnectTitle")}
      description={t("connections.confirmDisconnectDescription", { name: displayName })}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("connections.confirmDisconnectCancel")}
          </Button>
          <Button variant="outline" disabled={busy} className="text-destructive" onClick={() => onConfirm(target)}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Unplug className="size-4" />}
            {busy ? t("connections.disconnecting") : t("connections.disconnect")}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
        <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} />
        <div className="min-w-0">
          <div className="oo-text-label truncate">{provider.displayName}</div>
          <div className="oo-text-caption oo-text-muted truncate">
            {app ? getConnectionAppDisplayName(app) : (provider.accountLabel ?? provider.service)}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
