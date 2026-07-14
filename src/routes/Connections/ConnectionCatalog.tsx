import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { ConnectionCatalogFilter, ConnectionCategoryFilter } from "./connection-route-model.ts"

import { ChevronDown } from "lucide-react"
import * as React from "react"
import {
  categoryFilterLimit,
  categoryFilterPrefix,
  getFilterValue,
  getFittingCategoryFilterCount,
  getProviderActionLabel,
  getProviderMeta,
  getProviderStatusDisplayLabel,
  getProviderStatusTone,
  parseFilterValue,
  selectVisibleCategoryFilters,
} from "./connection-route-model.ts"
import {
  getProviderGridCenteredScrollTop,
  getProviderGridColumnCount,
  getProviderGridVisibleRange,
  providerGridCardHeightPx,
  providerGridGapPx,
} from "./provider-grid-virtualization.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { SearchField } from "@/components/SearchField"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function ConnectionDrawerSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      <div className="h-3 w-4/5 animate-pulse rounded-sm bg-muted" />
      <div className="h-3 w-3/5 animate-pulse rounded-sm bg-muted" />
      <div className="mt-1 h-8 w-28 animate-pulse rounded-md bg-muted" />
    </div>
  )
}

export function ConnectionListToolbar({
  activeFilter,
  attentionCount,
  categoryFilters,
  connectedCount,
  directlyAvailableCount,
  loading,
  onFilterChange,
  onQueryChange,
  query,
  totalCount,
}: {
  activeFilter: ConnectionCatalogFilter
  attentionCount: number
  categoryFilters: ConnectionCategoryFilter[]
  connectedCount: number
  directlyAvailableCount: number
  loading: boolean
  onFilterChange: (filter: ConnectionCatalogFilter) => void
  onQueryChange: (query: string) => void
  query: string
  totalCount: number
}) {
  const t = useT()
  const filterRowRef = React.useRef<HTMLDivElement | null>(null)
  const filterMeasurementRef = React.useRef<HTMLDivElement | null>(null)
  const [visibleCategoryCount, setVisibleCategoryCount] = React.useState(categoryFilterLimit)
  const selectedCategory = activeFilter.kind === "category" ? activeFilter.category : null
  const visibleCategoryFilters = selectVisibleCategoryFilters(categoryFilters, selectedCategory, visibleCategoryCount)
  const overflowCategoryFilters = categoryFilters.filter(
    (filter) => !visibleCategoryFilters.some((visibleFilter) => visibleFilter.label === filter.label),
  )
  const filterValue = getFilterValue(activeFilter)

  React.useLayoutEffect(() => {
    const filterRow = filterRowRef.current
    const measurement = filterMeasurementRef.current
    if (!filterRow || !measurement) {
      return
    }

    const getMeasurement = (name: string): number | null => {
      const element = measurement.querySelector<HTMLElement>(`[data-filter-measure="${name}"]`)
      return element ? element.getBoundingClientRect().width : null
    }

    const updateVisibleCategoryCount = () => {
      const availableWidth = filterRow.clientWidth
      const allWidth = getMeasurement("all")
      const connectedWidth = getMeasurement("connected")
      const attentionWidth = getMeasurement("attention")
      const directlyAvailableWidth = getMeasurement("directly-available")
      const moreWidth = getMeasurement("more")
      const categoryWidths = categoryFilters.map((_, index) => getMeasurement(`category-${index}`))
      if (
        !availableWidth ||
        allWidth === null ||
        connectedWidth === null ||
        attentionWidth === null ||
        directlyAvailableWidth === null ||
        moreWidth === null ||
        categoryWidths.some((width) => width === null)
      ) {
        return
      }

      const group = measurement.firstElementChild
      const gap = group ? Number.parseFloat(window.getComputedStyle(group).gap) || 4 : 4
      const categoryFilterWidths = new Map(
        categoryFilters.map((filter, index) => [filter.label, categoryWidths[index] ?? 0]),
      )
      const nextCount = getFittingCategoryFilterCount({
        availableWidth,
        baseFilterWidths: [allWidth, connectedWidth, directlyAvailableWidth, attentionWidth],
        categoryFilterWidths,
        filters: categoryFilters,
        gap,
        moreCategoriesWidth: moreWidth,
        selectedCategory,
      })

      setVisibleCategoryCount((current) => (current === nextCount ? current : nextCount))
    }

    updateVisibleCategoryCount()
    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(updateVisibleCategoryCount)
    observer.observe(filterRow)
    return () => observer.disconnect()
  }, [attentionCount, categoryFilters, connectedCount, directlyAvailableCount, loading, selectedCategory, totalCount])

  return (
    <div className="grid w-full min-w-0 gap-2">
      <SearchField
        value={query}
        placeholder={t("connections.search")}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <div ref={filterRowRef} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
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
            <FilterToggleItem count={loading ? null : totalCount} label={t("connections.filterAll")} value="all" />
            <FilterToggleItem
              count={loading ? null : connectedCount}
              label={t("connections.filterConnected")}
              value="connected"
            />
            <FilterToggleItem
              count={loading ? null : directlyAvailableCount}
              label={t("connections.filterDirectlyAvailable")}
              value="directly-available"
            />
            <FilterToggleItem
              count={loading ? null : attentionCount}
              label={t("connections.needsAttention")}
              value="attention"
            />
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
      <div ref={filterMeasurementRef} aria-hidden="true" className="pointer-events-none invisible absolute -z-10">
        <ToggleGroup type="single" variant="default" size="sm" spacing={1} className="flex w-max flex-nowrap gap-1">
          <span data-filter-measure="all">
            <FilterToggleItem count={loading ? null : totalCount} label={t("connections.filterAll")} value="all" />
          </span>
          <span data-filter-measure="connected">
            <FilterToggleItem
              count={loading ? null : connectedCount}
              label={t("connections.filterConnected")}
              value="connected"
            />
          </span>
          <span data-filter-measure="directly-available">
            <FilterToggleItem
              count={loading ? null : directlyAvailableCount}
              label={t("connections.filterDirectlyAvailable")}
              value="directly-available"
            />
          </span>
          <span data-filter-measure="attention">
            <FilterToggleItem
              count={loading ? null : attentionCount}
              label={t("connections.needsAttention")}
              value="attention"
            />
          </span>
          {categoryFilters.map((filter, index) => (
            <span key={filter.label} data-filter-measure={`category-${index}`}>
              <FilterToggleItem
                count={filter.count}
                label={filter.displayLabel}
                value={`${categoryFilterPrefix}${filter.label}`}
              />
            </span>
          ))}
          <span data-filter-measure="more">
            <Button variant="outline" size="sm" className="gap-1.5 rounded-md">
              {t("connections.moreCategories")}
              <ChevronDown className="size-4" />
            </Button>
          </span>
        </ToggleGroup>
      </div>
    </div>
  )
}

function FilterToggleItem({ count, label, value }: { count: number | null; label: string; value: string }) {
  return (
    <ToggleGroupItem
      value={value}
      className="group/filter max-w-48 cursor-pointer gap-1.5 rounded-md border border-[var(--oo-control-border)] px-2.5 transition-[background-color,border-color,color,box-shadow,transform] hover:border-[var(--selection-ring)] active:translate-y-px active:scale-[0.98] data-[state=on]:!border-[var(--accent-ring)] data-[state=on]:!bg-[var(--accent-soft)] data-[state=on]:!text-foreground data-[state=on]:!shadow-[inset_0_0_0_1px_var(--accent-ring)] data-[state=on]:hover:!bg-[var(--accent-soft)]"
    >
      <span className="truncate">{label}</span>
      {count === null ? (
        <span className="h-3 w-5 animate-pulse rounded-sm bg-muted" aria-hidden="true" />
      ) : (
        <span className="oo-text-micro oo-text-muted transition-colors group-data-[state=on]/filter:text-[var(--accent-strong)]">
          {count}
        </span>
      )}
    </ToggleGroupItem>
  )
}

export function ProviderListSkeleton() {
  return (
    <div
      className="grid"
      style={{ gap: providerGridGapPx, gridTemplateColumns: "repeat(auto-fill, minmax(13.5rem, 1fr))" }}
      aria-hidden="true"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <div
          key={index}
          className="grid h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-card px-2.5 py-1.5"
        >
          <div className="size-9 animate-pulse rounded-md bg-muted" />
          <div className="grid gap-1.5">
            <div className="h-4 w-32 animate-pulse rounded-sm bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded-sm bg-muted" />
          </div>
          <div className="h-3 w-12 animate-pulse rounded-sm bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function ProviderCatalog({
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
  const itemCount = providers.length
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const updateFrameRef = React.useRef<number | null>(null)
  const selectionCenterTimerRef = React.useRef<number | null>(null)
  const pendingSelectionRef = React.useRef<string | null>(null)
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

    setViewport((current) => {
      if (
        current.catalogTop !== nextViewport.catalogTop ||
        current.viewportHeight !== nextViewport.viewportHeight ||
        current.width !== nextViewport.width
      ) {
        return nextViewport
      }

      const columnCount = getProviderGridColumnCount(nextViewport.width)
      const currentRange = getProviderGridVisibleRange({
        catalogTop: current.catalogTop,
        columnCount,
        providerCount: itemCount,
        scrollTop: current.scrollTop,
        viewportHeight: current.viewportHeight,
      })
      const nextRange = getProviderGridVisibleRange({
        catalogTop: nextViewport.catalogTop,
        columnCount,
        providerCount: itemCount,
        scrollTop: nextViewport.scrollTop,
        viewportHeight: nextViewport.viewportHeight,
      })
      return currentRange.startIndex === nextRange.startIndex && currentRange.endIndex === nextRange.endIndex
        ? current
        : nextViewport
    })
  }, [itemCount, scrollParentRef])

  const scheduleViewportUpdate = React.useCallback(() => {
    if (updateFrameRef.current !== null) {
      return
    }

    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null
      updateViewport()
    })
  }, [updateViewport])

  const centerPendingSelection = React.useCallback(() => {
    const service = pendingSelectionRef.current
    const grid = gridRef.current
    const scrollParent = scrollParentRef.current
    if (!service || !grid || !scrollParent) {
      return
    }

    const providerIndex = providers.findIndex((provider) => provider.service === service)
    const itemIndex = providerIndex
    if (itemIndex < 0) {
      return
    }

    const gridRect = grid.getBoundingClientRect()
    const parentRect = scrollParent.getBoundingClientRect()
    const catalogTop = gridRect.top - parentRect.top + scrollParent.scrollTop
    const nextScrollTop = getProviderGridCenteredScrollTop({
      catalogTop,
      columnCount: getProviderGridColumnCount(grid.clientWidth),
      itemIndex,
      scrollHeight: scrollParent.scrollHeight,
      viewportHeight: scrollParent.clientHeight,
    })

    pendingSelectionRef.current = null
    scrollParent.scrollTo({ top: nextScrollTop })
    scheduleViewportUpdate()
  }, [providers, scheduleViewportUpdate, scrollParentRef])

  const schedulePendingSelectionCenter = React.useCallback(() => {
    if (!pendingSelectionRef.current) {
      return
    }
    if (selectionCenterTimerRef.current !== null) {
      window.clearTimeout(selectionCenterTimerRef.current)
    }
    selectionCenterTimerRef.current = window.setTimeout(() => {
      selectionCenterTimerRef.current = null
      centerPendingSelection()
    }, 80)
  }, [centerPendingSelection])

  React.useLayoutEffect(() => {
    updateViewport()
  }, [itemCount, updateViewport])

  React.useLayoutEffect(() => {
    pendingSelectionRef.current = selectedService
    if (selectedService) {
      schedulePendingSelectionCenter()
    } else if (selectionCenterTimerRef.current !== null) {
      window.clearTimeout(selectionCenterTimerRef.current)
      selectionCenterTimerRef.current = null
    }
  }, [providers, schedulePendingSelectionCenter, selectedService])

  React.useEffect(() => {
    const grid = gridRef.current
    const scrollParent = scrollParentRef.current
    if (!grid || !scrollParent) {
      return
    }

    const handleResize = () => {
      scheduleViewportUpdate()
      schedulePendingSelectionCenter()
    }
    const resizeObserver = new ResizeObserver(handleResize)
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
  }, [schedulePendingSelectionCenter, scheduleViewportUpdate, scrollParentRef])

  React.useEffect(
    () => () => {
      if (selectionCenterTimerRef.current !== null) {
        window.clearTimeout(selectionCenterTimerRef.current)
      }
    },
    [],
  )

  const columnCount = React.useMemo(() => getProviderGridColumnCount(viewport.width), [viewport.width])
  const visibleRange = React.useMemo(
    () =>
      getProviderGridVisibleRange({
        catalogTop: viewport.catalogTop,
        columnCount,
        providerCount: itemCount,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.viewportHeight,
      }),
    [columnCount, itemCount, viewport.catalogTop, viewport.scrollTop, viewport.viewportHeight],
  )
  const visibleItems = React.useMemo<Array<{ key: string; node: React.ReactNode }>>(() => {
    const items: Array<{ key: string; node: React.ReactNode }> = []
    for (let offset = 0; offset < visibleRange.endIndex - visibleRange.startIndex; offset += 1) {
      const index = visibleRange.startIndex + offset
      const provider = providers[index]
      if (provider) {
        items.push({
          key: provider.service,
          node: (
            <ProviderCard provider={provider} selected={provider.service === selectedService} onSelect={onSelect} />
          ),
        })
      }
    }
    return items
  }, [onSelect, providers, selectedService, visibleRange.endIndex, visibleRange.startIndex])

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
        {visibleItems.map((item) => (
          <React.Fragment key={item.key}>{item.node}</React.Fragment>
        ))}
      </div>
    </div>
  )
}

const ProviderCard = React.memo(function ProviderCard({
  provider,
  selected,
  onSelect,
}: {
  provider: ConnectionProviderSummary
  selected: boolean
  onSelect: (provider: ConnectionProviderSummary) => void
}) {
  const t = useT()
  const tone = getProviderStatusTone(provider)
  const statusLabel = getProviderStatusDisplayLabel(provider, t)
  return (
    <button
      type="button"
      onClick={() => onSelect(provider)}
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
        {tone === "directly-available" ? (
          <Badge
            variant="secondary"
            className="max-w-24 border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--accent-strong)]"
            title={statusLabel}
          >
            <span className="truncate">{statusLabel}</span>
          </Badge>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5" title={statusLabel}>
            {tone === "connected" || tone === "attention" ? (
              <span
                aria-label={statusLabel}
                className={cn(
                  "size-2 rounded-full",
                  tone === "connected" && "oo-connection-active-dot",
                  tone === "attention" && "bg-[var(--warning)]",
                )}
              />
            ) : null}
            <span className="oo-text-micro max-w-16 truncate font-medium text-muted-foreground">
              {getProviderActionLabel(provider, t)}
            </span>
          </span>
        )}
      </span>
    </button>
  )
})
