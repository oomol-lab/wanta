import type {
  ConnectionAppDetail,
  ConnectionAuthType,
  ConnectionAppSummary,
  ConnectionAppCredentialField,
  ConnectionCredentialField,
  ConnectionCredentialSummary,
  ConnectionProviderSummary,
  ConnectionSummary,
} from "../../../electron/connections/common.ts"
import type { MessageKey, TranslateFn } from "@/i18n/i18n"

import {
  connectionAppDisplayLabel as connectionAppUiDisplayLabel,
  isConnectionlessNoAuthProvider,
} from "../../../electron/connections/summary.ts"
import { authTypeLabel } from "./shared.ts"

export const executionLogLimit = 12
export const detailPaneAnimationMs = 150
/** 首次渲染前的保守展示数量；实际数量由工具栏可用宽度决定。 */
export const categoryFilterLimit = 4
export const accountActionButtonClassName = "h-7 gap-1.5 px-2"
export const categoryFilterPrefix = "category:"
export const uncategorizedCategoryValue = "__uncategorized__"
export const categoryMessageKeysByRawLabel: Record<string, MessageKey> = {
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

export type ConnectionCatalogFilter =
  | { kind: "all" }
  | { kind: "attention" }
  | { kind: "category"; category: string }
  | { kind: "connected" }

export interface ConnectionCategoryFilter {
  count: number
  displayLabel: string
  label: string
}

export interface DisconnectTarget {
  app?: ConnectionAppSummary
  provider: ConnectionProviderSummary
}

export function connectionDetailCacheKey(workspaceKey: string, service: string): string {
  return `${workspaceKey}\u0000${service}`
}

export function isConnectionDetailCacheKeyForService(cacheKey: string, service: string): boolean {
  return cacheKey.endsWith(`\u0000${service}`)
}

export function isConnected(provider: ConnectionProviderSummary): boolean {
  return provider.status === "connected"
}

export function isNoAuthReadyProvider(provider: ConnectionProviderSummary): boolean {
  return isConnectionlessNoAuthProvider(provider)
}

export function shouldLoadProviderDetail(provider: ConnectionProviderSummary): boolean {
  return !isNoAuthReadyProvider(provider)
}

export function getProviderStatusTone(provider: ConnectionProviderSummary): "attention" | "available" | "connected" {
  if (provider.status === "needs_attention") {
    return "attention"
  }
  if (provider.status === "connected") {
    return "connected"
  }
  return "available"
}

export function getProviderStatusLabel(provider: ConnectionProviderSummary, t: TranslateFn): string | null {
  switch (provider.status) {
    case "needs_attention":
      return t("connections.providerNeedsAttention")
    case "available":
      return t("connections.providerAvailable")
    case "connected":
      return null
  }
}

export function getDefaultAuthType(provider: ConnectionProviderSummary): Exclude<ConnectionAuthType, null> | null {
  if (provider.appAuthType && provider.authTypes.includes(provider.appAuthType)) {
    return provider.appAuthType
  }
  return provider.authTypes[0] ?? null
}

export function formatAuthTypes(authTypes: Exclude<ConnectionAuthType, null>[], t: TranslateFn): string {
  if (authTypes.length === 0) {
    return t("connections.authUnknown")
  }
  return authTypes.map((authType) => authTypeLabel(t, authType)).join(" / ")
}

export function isConnectionAuthType(
  value: string,
  authTypes: Exclude<ConnectionAuthType, null>[],
): value is Exclude<ConnectionAuthType, null> {
  return authTypes.some((authType) => authType === value)
}

export function formatDateTime(value: number | string | undefined, t: TranslateFn): string {
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

export function formatUsageDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" })
}

export function formatDuration(durationMs: number | null, t: TranslateFn): string {
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

export function getProviderDescription(provider: ConnectionProviderSummary, t: TranslateFn): string {
  switch (provider.status) {
    case "needs_attention":
      return t("connections.providerNeedsAttentionDescription", { name: provider.displayName })
    case "connected":
      if (isNoAuthReadyProvider(provider)) {
        return t("connections.noAuthReadyDescription")
      }
      if (provider.appCount > 1) {
        return t("connections.connectionCount", { count: provider.appCount })
      }
      return provider.accountLabel ?? getProviderCategoryLabel(provider, t)
    case "available":
      return getProviderCategoryLabel(provider, t)
  }
}

export function getProviderAccountValue(provider: ConnectionProviderSummary, t: TranslateFn): string {
  if (isNoAuthReadyProvider(provider)) {
    return t("connections.noAccountRequired")
  }
  if (provider.appCount === 1 && provider.accountLabel) {
    return provider.accountLabel
  }
  if (provider.appCount > 0) {
    return t("connections.connectionCount", { count: provider.appCount })
  }
  return t("connections.notConnected")
}

export function getEmptyState(
  summary: ConnectionSummary | null,
  t: TranslateFn,
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

export function authTypeNeedsDialog(authType: Exclude<ConnectionAuthType, null>): boolean {
  return authType === "api_key" || authType === "custom_credential" || authType === "federated"
}

export function getProviderStatusDisplayLabel(provider: ConnectionProviderSummary, t: TranslateFn): string {
  return getProviderStatusLabel(provider, t) ?? t("connections.connected")
}

export function getProviderActionLabel(provider: ConnectionProviderSummary, t: TranslateFn): string {
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

export function getCategoryDisplayLabel(label: string, t: TranslateFn): string {
  if (label === uncategorizedCategoryValue) {
    return t("connections.categoryUnknown")
  }
  const key = categoryMessageKeysByRawLabel[label]
  return key ? t(key) : label
}

export function getProviderCategoryRawLabels(provider: ConnectionProviderSummary): string[] {
  return provider.categoryLabels.length > 0 ? provider.categoryLabels : [uncategorizedCategoryValue]
}

export function getProviderCategoryLabel(provider: ConnectionProviderSummary, t: TranslateFn): string {
  return getCategoryDisplayLabel(getProviderCategoryRawLabels(provider)[0] ?? uncategorizedCategoryValue, t)
}

export function formatProviderCategoryLabels(provider: ConnectionProviderSummary, t: TranslateFn): string {
  return getProviderCategoryRawLabels(provider)
    .map((label) => getCategoryDisplayLabel(label, t))
    .join(" / ")
}

export function getProviderMeta(provider: ConnectionProviderSummary, t: TranslateFn): string {
  if (isNoAuthReadyProvider(provider)) {
    return t("connections.noAccountRequired")
  }
  if (provider.status === "connected" && provider.appCount === 1 && provider.accountLabel) {
    return provider.accountLabel
  }
  if (provider.status === "connected") {
    return t("connections.connectionCount", { count: provider.appCount })
  }
  return getProviderCategoryLabel(provider, t)
}

export function getConnectionAppGeneratedLabel(app: ConnectionAppSummary, index: number, t: TranslateFn): string {
  const authLabel = app.authType ? authTypeLabel(t, app.authType) : t("connections.authUnknown")
  return t("connections.generatedConnectionLabel", { auth: authLabel, index: index + 1 })
}

export function getConnectionAppDisplayLabel(app: ConnectionAppSummary, index: number, t: TranslateFn): string {
  return connectionAppUiDisplayLabel(app) ?? getConnectionAppGeneratedLabel(app, index, t)
}

export function normalizeConnectionAliasInput(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "").replace(/^-+/, "")
}

export function getConnectionAppNote(app: ConnectionAppDetail | null | undefined): string {
  return app?.comment?.trim() ?? ""
}

export function buildCredentialSummaryDisplayValues(
  fields: readonly Pick<ConnectionCredentialField, "key" | "secret">[],
  summary: ConnectionCredentialSummary | undefined,
): Record<string, string> {
  if (!summary) {
    return {}
  }

  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field.secret) {
        return []
      }
      const value = summary.fields[field.key]?.displayValue
      return value ? [[field.key, value]] : []
    }),
  )
}

export function buildFederatedCredentialDisplayValues(
  fields: readonly Pick<ConnectionCredentialField, "key">[],
  credentialFields: readonly ConnectionAppCredentialField[] | undefined,
): Record<string, string> {
  if (!credentialFields?.length) {
    return {}
  }

  const fieldKeys = new Set(fields.map((field) => field.key))
  return Object.fromEntries(
    credentialFields.flatMap((field) => {
      if (field.secret || !fieldKeys.has(field.key)) {
        return []
      }
      return field.displayValue ? [[field.key, field.displayValue]] : []
    }),
  )
}

export function matchesProviderQuery(
  provider: ConnectionProviderSummary,
  normalizedQuery: string,
  t: TranslateFn,
): boolean {
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
    provider.apps.some((app) => {
      const candidates = [app.displayName, app.alias, app.accountLabel, app.providerAccountId, app.id]
      return candidates.some((value) => value?.toLowerCase().includes(normalizedQuery))
    })
  )
}

export function getFilterValue(filter: ConnectionCatalogFilter): string {
  return filter.kind === "category" ? `${categoryFilterPrefix}${filter.category}` : filter.kind
}

export function parseFilterValue(value: string): ConnectionCatalogFilter | null {
  if (value === "all" || value === "connected" || value === "attention") {
    return { kind: value }
  }
  if (value.startsWith(categoryFilterPrefix)) {
    const category = value.slice(categoryFilterPrefix.length)
    return category ? { kind: "category", category } : null
  }
  return null
}

export function buildCategoryFilters(
  providers: ConnectionProviderSummary[],
  t: TranslateFn,
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

export function selectVisibleCategoryFilters(
  filters: ConnectionCategoryFilter[],
  selectedCategory: string | null,
  limit: number,
): ConnectionCategoryFilter[] {
  const visibleFilters = filters.slice(0, Math.max(0, limit))
  if (
    !selectedCategory ||
    visibleFilters.some((filter) => filter.label === selectedCategory) ||
    !visibleFilters.length
  ) {
    return visibleFilters
  }

  const selectedFilter = filters.find((filter) => filter.label === selectedCategory)
  return selectedFilter ? [...visibleFilters.slice(0, -1), selectedFilter] : visibleFilters
}

export function getFittingCategoryFilterCount({
  availableWidth,
  baseFilterWidths,
  categoryFilterWidths,
  filters,
  gap,
  moreCategoriesWidth,
  selectedCategory,
}: {
  availableWidth: number
  baseFilterWidths: readonly number[]
  categoryFilterWidths: ReadonlyMap<string, number>
  filters: ConnectionCategoryFilter[]
  gap: number
  moreCategoriesWidth: number
  selectedCategory: string | null
}): number {
  let fittingCount = 0

  for (let count = 0; count <= filters.length; count += 1) {
    const visibleFilters = selectVisibleCategoryFilters(filters, selectedCategory, count)
    const visibleWidths = visibleFilters.map((filter) => categoryFilterWidths.get(filter.label) ?? Infinity)
    const hasOverflow = visibleFilters.length < filters.length
    const widths = hasOverflow
      ? [...baseFilterWidths, ...visibleWidths, moreCategoriesWidth]
      : [...baseFilterWidths, ...visibleWidths]
    const requiredWidth = widths.reduce((total, width) => total + width, 0) + gap * Math.max(0, widths.length - 1)
    if (requiredWidth <= availableWidth) {
      fittingCount = count
    }
  }

  return fittingCount
}

export function matchesProviderFilter(provider: ConnectionProviderSummary, filter: ConnectionCatalogFilter): boolean {
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
