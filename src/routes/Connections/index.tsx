import type {
  ConnectionAuthType,
  ConnectionConnectInput,
  ConnectionExecutionLogSummary,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
  ConnectionSummary,
  ConnectionUsageDailyPoint,
  ConnectionUsageServiceItem,
} from "../../../electron/connections/common.ts"
import type { UseConnections } from "@/hooks/useConnections"
import type { MessageKey, TranslateFn } from "@/i18n/i18n"

import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { authTypeLabel } from "./shared.ts"
import { Loader } from "@/components/ai-elements/loader"
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
  SplitViewListPane,
  SplitViewMobileDetailPane,
  SplitViewRoot,
} from "@/components/ui/split-view"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const executionLogLimit = 12
const categoryFilterLimit = 4
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
      return provider.accountLabel
        ? t("connections.providerConnectedAccountDescription", {
            account: provider.accountLabel,
            name: provider.displayName,
          })
        : t("connections.providerConnectedDescription", { name: provider.displayName })
    case "available":
      return t("connections.providerAvailableDescription", { name: provider.displayName })
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

function getProviderCatalogMeta(provider: ConnectionProviderSummary, t: ReturnType<typeof useT>): string {
  if (provider.accountLabel) {
    return provider.accountLabel
  }
  return getProviderCategoryLabel(provider, t)
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
    provider.accountLabel?.toLowerCase().includes(normalizedQuery) === true
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
  connections: UseConnections
  selectedService?: string | null
}

export function ConnectionsPanel({ connections, selectedService }: ConnectionsPanelProps) {
  const t = useT()
  const { summary, busy, polling, error, connect, disconnect, cancelPolling, getProviderDetail } = connections
  const [query, setQuery] = React.useState("")
  const [activeFilter, setActiveFilter] = React.useState<ConnectionCatalogFilter>({ kind: "all" })
  const [selectedProviderService, setSelectedProviderService] = React.useState<string | null>(null)
  const [narrowPane, setNarrowPane] = React.useState<"detail" | "list">("list")
  const [detail, setDetail] = React.useState<ConnectionProviderDetail | null>(null)
  const [detailService, setDetailService] = React.useState<string | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<{
    authType: "api_key" | "custom_credential" | "federated"
    detail: ConnectionProviderDetail
  } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<ConnectionProviderSummary | null>(null)

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
  const filteredProviders = React.useMemo(
    () => catalogProviders.filter((provider) => matchesProviderQuery(provider, normalizedQuery, t)),
    [catalogProviders, normalizedQuery, t],
  )
  const selectedProvider =
    filteredProviders.find((provider) => provider.service === selectedProviderService) ?? filteredProviders[0] ?? null

  React.useEffect(() => {
    if (!selectedService) {
      return
    }

    setQuery("")
    setActiveFilter({ kind: "all" })
    setSelectedProviderService(selectedService)
    setNarrowPane("detail")
  }, [selectedService])

  React.useEffect(() => {
    if (activeFilter.kind !== "category") {
      return
    }
    if (!categoryFilters.some((filter) => filter.label === activeFilter.category)) {
      setActiveFilter({ kind: "all" })
    }
  }, [activeFilter, categoryFilters])

  React.useEffect(() => {
    if (!selectedProvider) {
      setSelectedProviderService(null)
      return
    }

    setSelectedProviderService((current) =>
      current && filteredProviders.some((provider) => provider.service === current)
        ? current
        : selectedProvider.service,
    )
  }, [filteredProviders, selectedProvider])

  React.useEffect(() => {
    if (!selectedProvider) {
      setDetail(null)
      setDetailService(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }

    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void getProviderDetail(selectedProvider.service)
      .then((next) => {
        if (!cancelled) {
          setDetail(next)
          setDetailService(selectedProvider.service)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null)
          setDetailService(null)
          setDetailError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [getProviderDetail, selectedProvider])

  const connectProvider = React.useCallback(
    async (provider: ConnectionProviderSummary, authType: Exclude<ConnectionAuthType, null>): Promise<void> => {
      if (authType === "oauth2" || authType === "no_auth") {
        const input: ConnectionConnectInput = { authType, service: provider.service }
        await connect(input)
        return
      }

      const loaded = detailService === provider.service && detail ? detail : await getProviderDetail(provider.service)
      setDialog({ detail: loaded, authType })
    },
    [connect, detail, detailService, getProviderDetail],
  )

  return (
    <SplitViewRoot narrowPane={narrowPane} className="grid-rows-[minmax(0,1fr)]">
      <SplitViewBody desktopLayout="narrow-list">
        <SplitViewListPane narrowPane={narrowPane}>
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
          <div className="grid gap-3">
            <SummaryHeader />
            {summary && summary.status !== "ready" && <StatusNotice summary={summary} />}
            {error && <div className="oo-error oo-text-micro">{error}</div>}
            {filteredProviders.length === 0 ? (
              <EmptyList summary={summary} hasQuery={Boolean(normalizedQuery)} />
            ) : (
              <div className="grid gap-1">
                {filteredProviders.map((provider) => (
                  <ProviderRow
                    key={provider.service}
                    provider={provider}
                    selected={provider.service === selectedProvider?.service}
                    onSelect={() => {
                      setSelectedProviderService(provider.service)
                      setNarrowPane("detail")
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </SplitViewListPane>

        <SplitViewMobileDetailPane narrowPane={narrowPane}>
          <div className="mb-2">
            <Button variant="ghost" size="sm" onClick={() => setNarrowPane("list")}>
              <ArrowLeft className="size-4" />
              {t("connections.backToProviders")}
            </Button>
          </div>
          {selectedProvider ? (
            <ProviderDetail
              actionError={error}
              busy={busy}
              detail={detailService === selectedProvider.service ? detail : null}
              detailError={detailError}
              detailLoading={detailLoading}
              connections={connections}
              onCancelPolling={cancelPolling}
              onConnect={connectProvider}
              onDisconnect={setConfirmDisconnect}
              polling={polling}
              provider={selectedProvider}
              summary={summary}
            />
          ) : (
            <EmptyDetail summary={summary} />
          )}
        </SplitViewMobileDetailPane>

        <SplitViewDesktopDetailPane>
          {selectedProvider ? (
            <ProviderDetail
              actionError={error}
              busy={busy}
              detail={detailService === selectedProvider.service ? detail : null}
              detailError={detailError}
              detailLoading={detailLoading}
              connections={connections}
              onCancelPolling={cancelPolling}
              onConnect={connectProvider}
              onDisconnect={setConfirmDisconnect}
              polling={polling}
              provider={selectedProvider}
              summary={summary}
            />
          ) : (
            <EmptyDetail summary={summary} />
          )}
        </SplitViewDesktopDetailPane>
      </SplitViewBody>

      <ConnectDialog
        open={dialog !== null}
        detail={dialog?.detail ?? null}
        authType={dialog?.authType ?? null}
        busy={busy === "connect"}
        onClose={() => setDialog(null)}
        onSubmit={async (input) => {
          const ok = await connect(input)
          if (ok) {
            setDialog(null)
          }
        }}
        onOpenUrl={(url) => void connections.openExternal(url)}
      />

      <DisconnectDialog
        provider={confirmDisconnect}
        busy={busy === "disconnect"}
        onClose={() => setConfirmDisconnect(null)}
        onConfirm={async (provider) => {
          const ok = await disconnect(provider.service)
          if (ok) {
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
    <div className="grid gap-2 pt-3 pb-2">
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

function SummaryHeader() {
  const t = useT()
  return (
    <div className="grid gap-1 px-1 py-1">
      <div className="oo-text-title truncate">{t("connections.providers")}</div>
    </div>
  )
}

function ProviderRow({
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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40",
        selected && "bg-accent text-accent-foreground",
      )}
    >
      <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="oo-text-control truncate font-medium">{provider.displayName}</span>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              tone === "connected" && "bg-[var(--success)]",
              tone === "attention" && "bg-[var(--warning)]",
              tone === "available" && "bg-muted-foreground/40",
            )}
          />
        </div>
        <div className="oo-text-micro oo-text-muted truncate">{getProviderCatalogMeta(provider, t)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {provider.status !== "available" ? (
          <ProviderStatusBadge provider={provider} className="hidden min-[640px]:inline-flex" />
        ) : null}
        <span className="oo-text-control max-w-20 truncate font-medium text-muted-foreground group-hover:text-foreground">
          {getProviderActionLabel(provider, t)}
        </span>
        <ChevronRight className="oo-icon-muted size-4" />
      </div>
    </button>
  )
}

function ProviderStatusBadge({ className, provider }: { className?: string; provider: ConnectionProviderSummary }) {
  const t = useT()
  const tone = getProviderStatusTone(provider)
  return (
    <Badge
      variant={tone === "connected" ? "success" : tone === "attention" ? "warning" : "muted"}
      className={className}
    >
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

function EmptyDetail({ summary }: { summary: ConnectionSummary | null }) {
  const t = useT()
  const state = getEmptyState(summary, t)
  return (
    <section className="grid gap-2 rounded-lg border px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Plug className="oo-icon-muted size-4" />
        <div className="oo-text-title truncate">{state.title}</div>
      </div>
      <p className="oo-text-caption oo-text-muted">{state.description}</p>
    </section>
  )
}

function ProviderDetail({
  actionError,
  busy,
  detail,
  detailError,
  detailLoading,
  connections,
  onCancelPolling,
  onConnect,
  onDisconnect,
  polling,
  provider,
  summary,
}: {
  actionError: string | null
  busy: UseConnections["busy"]
  connections: UseConnections
  detail: ConnectionProviderDetail | null
  detailError: string | null
  detailLoading: boolean
  onCancelPolling: () => void
  onConnect: (provider: ConnectionProviderSummary, authType: Exclude<ConnectionAuthType, null>) => Promise<void>
  onDisconnect: (provider: ConnectionProviderSummary) => void
  polling: string | null
  provider: ConnectionProviderSummary
  summary: ConnectionSummary | null
}) {
  const t = useT()
  const currentAuthType = getDefaultAuthType(provider)
  const usage = summary?.usage.services.find((item) => item.service === provider.service)

  return (
    <div className="grid min-w-0 gap-3">
      {summary && summary.status !== "ready" ? <StatusNotice summary={summary} /> : null}

      <section className="grid gap-2 rounded-md border px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-3">
          <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="oo-text-title truncate">{provider.displayName}</h2>
              {getProviderStatusLabel(provider, t) ? (
                <Badge variant={provider.status === "needs_attention" ? "warning" : "muted"}>
                  {getProviderStatusLabel(provider, t)}
                </Badge>
              ) : (
                <Badge variant="success">{t("connections.connectedConnection")}</Badge>
              )}
            </div>
            <p className="oo-text-caption oo-text-muted mt-1 break-words">{getProviderDescription(provider, t)}</p>
          </div>
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
        </div>
        {actionError ? <div className="oo-error oo-text-micro">{actionError}</div> : null}
        {detailError ? <div className="oo-error oo-text-micro">{detailError}</div> : null}
        <ConnectionPanel
          busy={busy}
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
          <DetailRow label={t("connections.account")} value={provider.accountLabel ?? t("connections.notConnected")} />
          <DetailRow label={t("connections.auth")} value={formatAuthTypes(provider.authTypes, t)} />
          <DetailRow label={t("connections.category")} value={formatProviderCategoryLabels(provider, t)} />
          <DetailRow label={t("connections.service")} value={provider.service} mono />
          <DetailRow label={t("connections.updatedAt")} value={formatDateTime(provider.connectedUpdatedAt, t)} />
        </dl>
      </section>
    </div>
  )
}

function ConnectionPanel({
  busy,
  currentAuthType,
  detail,
  detailLoading,
  onCancelPolling,
  onConnect,
  onDisconnect,
  polling,
  provider,
}: {
  busy: UseConnections["busy"]
  currentAuthType: Exclude<ConnectionAuthType, null> | null
  detail: ConnectionProviderDetail | null
  detailLoading: boolean
  onCancelPolling: () => void
  onConnect: (provider: ConnectionProviderSummary, authType: Exclude<ConnectionAuthType, null>) => Promise<void>
  onDisconnect: (provider: ConnectionProviderSummary) => void
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
    <div className="grid gap-2 border-t pt-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="oo-text-title truncate">
            {isConnected(provider) ? t("connections.connectedConnection") : t("connections.connectProvider")}
          </h3>
          <p className="oo-text-caption oo-text-muted">
            {isConnected(provider)
              ? t("connections.connectedConnectionDescription", {
                  auth: activeAuthType ? authTypeLabel(t, activeAuthType) : t("connections.authUnknown"),
                })
              : t("connections.availableConnectionDescription")}
          </p>
        </div>
        {detailLoading ? <Loader className="oo-icon-muted" size={16} /> : null}
      </div>

      <AuthTypeToggleGroup authTypes={usableAuthTypes} value={activeAuthType ?? null} onChange={setSelectedAuthType} />

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
              {isConnected(provider) ? t("connections.modifyConnection") : t("connections.connectProvider")}
            </Button>
          )}

          {isConnected(provider) && provider.canDisconnect ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "disconnect"}
              className="gap-1.5 border-[var(--oo-danger-border)] text-destructive hover:bg-[var(--oo-danger-surface)] hover:text-destructive"
              onClick={() => onDisconnect(provider)}
            >
              <Unplug className="size-4" />
              {t("connections.disconnect")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="oo-text-caption oo-text-muted">{t("connections.unsupportedConnectionDescription")}</div>
      )}
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
  const [error, setError] = React.useState<string | null>(null)
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
      setError(err instanceof Error ? err.message : String(err))
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
      <h3 className="oo-text-title px-0.5">{t("connections.usageTitle")}</h3>
      <button
        type="button"
        className="group grid min-w-0 gap-2 rounded-md bg-[var(--oo-inspector-surface)] px-2.5 py-2 text-left transition-colors outline-none hover:bg-[var(--oo-surface-raised)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={t("connections.viewUsageForProvider", { name: provider.displayName })}
        onClick={() => setIsUsageDialogOpen(true)}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <div className="oo-text-title truncate">{usageTitle}</div>
            <div className="oo-text-caption oo-text-muted truncate">{usageDetail}</div>
          </div>
          <span className="oo-text-caption oo-text-muted inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 group-hover:text-foreground">
            <BarChart3 className="size-3.5" />
            {t("connections.viewUsage")}
          </span>
        </div>
      </button>
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
  error: string | null
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
  error: string | null
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
        <div className="oo-error oo-text-micro">{error}</div>
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
  provider,
  busy,
  onClose,
  onConfirm,
}: {
  provider: ConnectionProviderSummary | null
  busy: boolean
  onClose: () => void
  onConfirm: (provider: ConnectionProviderSummary) => void
}) {
  const t = useT()
  if (!provider) {
    return null
  }

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={t("connections.confirmDisconnectTitle")}
      description={t("connections.confirmDisconnectDescription", { name: provider.displayName })}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("connections.confirmDisconnectCancel")}
          </Button>
          <Button variant="outline" disabled={busy} className="text-destructive" onClick={() => onConfirm(provider)}>
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
          <div className="oo-text-caption oo-text-muted truncate">{provider.accountLabel ?? provider.service}</div>
        </div>
      </div>
    </Dialog>
  )
}
