import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildCredentialSummaryDisplayValues,
  buildFederatedCredentialDisplayValues,
  canMutateConnectionApp,
  canMutateConnections,
  connectionDetailCacheKey,
  getConnectionAppNote,
  getConnectionAppDisplayLabel,
  getDefaultAuthType,
  getFittingCategoryFilterCount,
  getProviderAccountValue,
  getProviderActionLabel,
  getProviderCatalogLabel,
  getProviderCategoryRawLabels,
  getProviderDescription,
  getProviderMeta,
  getProviderStatusDisplayLabel,
  getProviderStatusTone,
  isConnected,
  isDirectlyAvailableProvider,
  isManagedConnection,
  isMarketplaceApp,
  matchesConnectionDiscoveryCategory,
  matchesProviderFilter,
  matchesProviderQuery,
  normalizeConnectionCatalogFilter,
  normalizeConnectionAliasInput,
  parseFilterValue,
  resolveConnectionDiscoveryCategory,
  selectVisibleCategoryFilters,
  shouldShowConnectionState,
  shouldLoadProviderDetail,
  shouldShowProviderUpdatedAt,
  supportsManagedConnectionAccountActions,
} from "./connection-route-model.ts"
import { translate } from "@/i18n/i18n"

function provider(overrides: Partial<ConnectionProviderSummary>): ConnectionProviderSummary {
  return {
    actionKind: "oauth2",
    appCount: 0,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: false,
    categoryLabels: [],
    displayName: "Provider",
    service: "provider",
    status: "available",
    ...overrides,
  }
}

test("directly available providers stay outside configured connection counts", () => {
  const ready = provider({
    actionKind: "no_auth",
    authTypes: ["no_auth"],
    displayName: "QuickChart",
    service: "quickchart",
    status: "connected",
  })

  assert.equal(isConnected(ready), false)
  assert.equal(isDirectlyAvailableProvider(ready), true)
  assert.equal(shouldLoadProviderDetail(ready), false)
  assert.equal(
    getProviderMeta(ready, (key, vars) => translate("en", key, vars)),
    "Uncategorized",
  )
  assert.equal(
    getProviderAccountValue(ready, (key, vars) => translate("en", key, vars)),
    "No account required",
  )
  assert.equal(
    getProviderStatusDisplayLabel(ready, (key, vars) => translate("en", key, vars)),
    "No setup",
  )
})

test("managed no-auth accounts are not treated as connectionless providers", () => {
  const ready = provider({
    actionKind: "no_auth",
    appAuthType: "no_auth",
    appCount: 1,
    appStatus: "active",
    authTypes: ["no_auth"],
    status: "connected",
  })

  assert.equal(isConnected(ready), true)
  assert.equal(isDirectlyAvailableProvider(ready), false)
  assert.equal(shouldLoadProviderDetail(ready), true)
})

test("direct CLI providers use local details and direct-mode catalog metadata", () => {
  const direct = provider({
    executionMode: "direct",
    runtimeVersion: "1.0.81",
    service: "lark-cli",
  })
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  assert.equal(shouldLoadProviderDetail(direct), false)
  assert.equal(supportsManagedConnectionAccountActions(direct), false)
  assert.equal(getProviderMeta(direct, t), "Direct mode")
})

test("providers needing attention show the reauthorization hint over their marketing description", () => {
  const attention = provider({ description: "Marketing copy", displayName: "Lark CLI", status: "needs_attention" })
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  assert.equal(getProviderDescription(attention, t), "Lark CLI needs attention before it can be used.")
})

test("remote providers retain Connector-managed account actions", () => {
  assert.equal(supportsManagedConnectionAccountActions(provider({ service: "github" })), true)
})

test("Marketplace connections are selectable but not mutable credentials", () => {
  const marketplaceApp = {
    authType: "marketplace" as const,
    createdAt: 0,
    id: "marketplace:oomol:tikhub",
    isDefault: true,
    marketplace: { id: "oomol", pricing: "metered" as const },
    service: "tikhub",
    status: "active" as const,
    updatedAt: 0,
  }
  const managed = provider({
    actionKind: "api_key",
    appAuthType: "marketplace",
    appCount: 1,
    appId: marketplaceApp.id,
    apps: [marketplaceApp],
    authTypes: ["api_key"],
    status: "connected",
  })
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  assert.equal(isMarketplaceApp(marketplaceApp), true)
  assert.equal(canMutateConnectionApp(marketplaceApp), false)
  assert.equal(getDefaultAuthType(managed), "api_key")
  assert.equal(getConnectionAppDisplayLabel(marketplaceApp, 0, t), "OOMOL built-in account")
  assert.equal(getProviderAccountValue(managed, t), "OOMOL built-in account")
  assert.equal(getProviderDescription(managed, t), "Official managed calls may consume OOMOL Credits.")
  assert.equal(shouldShowProviderUpdatedAt(managed), false)
  assert.equal(shouldShowProviderUpdatedAt(provider({ appAuthType: "api_key", status: "connected" })), true)

  const metadataOnly = { ...marketplaceApp, authType: "api_key" as const, id: "managed-metadata-only" }
  const prefixOnly = { ...marketplaceApp, authType: "api_key" as const, marketplace: undefined }
  assert.equal(isMarketplaceApp(metadataOnly), true)
  assert.equal(canMutateConnectionApp(metadataOnly), false)
  assert.equal(isMarketplaceApp(prefixOnly), true)
  assert.equal(canMutateConnectionApp(prefixOnly), false)
})

test("mixed direct and API key providers are directly available before configuration", () => {
  const ready = provider({
    actionKind: "api_key",
    authTypes: ["no_auth", "api_key"],
    displayName: "PubMed",
    service: "pubmed",
    status: "connected",
  })
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  assert.equal(isDirectlyAvailableProvider(ready), true)
  assert.equal(isConnected(ready), false)
  assert.equal(shouldLoadProviderDetail(ready), true)
  assert.equal(matchesProviderFilter(ready, { kind: "directly-available" }), true)
  assert.equal(getProviderStatusTone(ready), "directly-available")
  assert.equal(getProviderActionLabel(ready, t), "No setup")
})

test("read-only provider labels describe state instead of offering management actions", () => {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  assert.equal(getProviderCatalogLabel(provider({ status: "available" }), false, t), "Not connected")
  assert.equal(getProviderCatalogLabel(provider({ appCount: 1, status: "connected" }), false, t), "Connected")
  assert.equal(getProviderCatalogLabel(provider({ status: "needs_attention" }), false, t), "Needs attention")
  assert.equal(getProviderCatalogLabel(provider({ status: "available" }), true, t), "Connect")
})

test("availability catalog filters round trip", () => {
  assert.deepEqual(parseFilterValue("available-tools"), { kind: "available-tools" })
  assert.deepEqual(parseFilterValue("directly-available"), { kind: "directly-available" })
})

test("connection catalog filter rejects click events and malformed categories", () => {
  assert.deepEqual(normalizeConnectionCatalogFilter({ type: "click" }), { kind: "all" })
  assert.deepEqual(normalizeConnectionCatalogFilter({ kind: "category", category: "" }), { kind: "all" })
  assert.deepEqual(normalizeConnectionCatalogFilter({ kind: "connected" }), { kind: "connected" })
  assert.deepEqual(normalizeConnectionCatalogFilter({ kind: "category", category: "Productivity" }), {
    kind: "category",
    category: "Productivity",
  })
})

test("team connection state is visible whenever the member read succeeds", () => {
  assert.equal(shouldShowConnectionState(undefined), false)
  assert.equal(shouldShowConnectionState("unavailable"), false)
  assert.equal(shouldShowConnectionState("forbidden"), false)
  assert.equal(shouldShowConnectionState("ready"), true)
})

test("connection mutations require management permission and a confirmed team state", () => {
  assert.equal(canMutateConnections(false, "ready"), false)
  assert.equal(canMutateConnections(true, undefined), false)
  assert.equal(canMutateConnections(true, "unavailable"), false)
  assert.equal(canMutateConnections(true, "forbidden"), false)
  assert.equal(canMutateConnections(true, "ready"), true)
})

test("available tools filter combines connected and directly available providers", () => {
  const connected = provider({ appCount: 1, status: "connected" })
  const directlyAvailable = provider({ actionKind: "no_auth", authTypes: ["no_auth"], status: "connected" })

  assert.equal(matchesProviderFilter(connected, { kind: "available-tools" }), true)
  assert.equal(matchesProviderFilter(directlyAvailable, { kind: "available-tools" }), true)
  assert.equal(matchesProviderFilter(provider({ status: "available" }), { kind: "available-tools" }), false)
  assert.equal(matchesProviderFilter(provider({ status: "needs_attention" }), { kind: "available-tools" }), false)
})

test("my connections excludes ordinary no-setup providers while retaining configured direct connections", () => {
  const noSetup = provider({ actionKind: "no_auth", authTypes: ["no_auth"], status: "connected" })
  const directConnection = provider({
    actionKind: "oauth2",
    authTypes: ["oauth2"],
    executionMode: "direct",
    service: "lark-cli",
    status: "connected",
  })
  const attention = provider({ status: "needs_attention" })
  const directNoAuth = provider({
    actionKind: "no_auth",
    authTypes: ["no_auth"],
    executionMode: "direct",
    service: "wecom-cli",
    status: "connected",
  })

  assert.equal(isManagedConnection(noSetup), false)
  assert.equal(isManagedConnection(directConnection), true)
  assert.equal(isManagedConnection(attention), true)
  assert.equal(isManagedConnection(directNoAuth), true)
  assert.equal(matchesProviderFilter(noSetup, { kind: "managed" }), false)
  assert.equal(matchesProviderFilter(directConnection, { kind: "managed" }), true)
  assert.equal(matchesProviderFilter(directNoAuth, { kind: "managed" }), true)
})

test("discovery categories combine raw catalog labels into task-led groups", () => {
  const documentation = provider({ categoryLabels: ["Documentation"], service: "notion" })
  const storage = provider({ categoryIds: ["data-storage"], categoryLabels: ["存储"], service: "storage-provider" })
  const social = provider({ categoryIds: ["communication"], categoryLabels: ["社交"], service: "linkedin" })
  const finance = provider({ categoryIds: ["productivity"], categoryLabels: ["财务"], service: "finance-provider" })
  const maps = provider({ categoryIds: ["data-storage"], categoryLabels: ["地图"], service: "maps" })

  assert.equal(matchesConnectionDiscoveryCategory(documentation, "knowledge"), true)
  assert.equal(matchesConnectionDiscoveryCategory(storage, "data-storage"), true)
  assert.equal(matchesConnectionDiscoveryCategory(social, "communication"), true)
  assert.equal(matchesConnectionDiscoveryCategory(finance, "productivity"), true)
  assert.equal(matchesConnectionDiscoveryCategory(maps, "data-storage"), true)
  assert.equal(matchesProviderFilter(storage, { kind: "discovery-category", category: "data-storage" }), true)
  assert.equal(matchesProviderFilter(storage, { kind: "discovery-category", category: "developer" }), false)
})

test("stable category ids drive one cross-locale discovery category per provider", () => {
  const localizedDeveloper = provider({
    categoryIds: ["developer"],
    categoryLabels: ["开发工具"],
    service: "github",
  })
  const primaryCategoryWins = provider({
    categoryIds: ["communication", "docs"],
    categoryLabels: ["沟通协作", "文档与知识"],
    service: "multi-category",
  })
  const crossBorderOverride = provider({
    categoryIds: ["developer"],
    categoryLabels: ["开发工具"],
    service: "shopify_admin",
  })

  assert.equal(resolveConnectionDiscoveryCategory(localizedDeveloper), "developer")
  assert.equal(matchesConnectionDiscoveryCategory(localizedDeveloper, "developer"), true)
  assert.equal(resolveConnectionDiscoveryCategory(primaryCategoryWins), "communication")
  assert.equal(matchesConnectionDiscoveryCategory(primaryCategoryWins, "knowledge"), false)
  assert.equal(resolveConnectionDiscoveryCategory(crossBorderOverride), "cross-border-ecommerce")
})

test("cross-border ecommerce providers receive a stable catalog category", () => {
  assert.equal(getProviderCategoryRawLabels(provider({ service: "shopify_admin" }))[0], "Cross-Border Ecommerce")
  assert.deepEqual(
    getProviderCategoryRawLabels(
      provider({
        categoryLabels: [" E-commerce ", "ecommerce", " Productivity ", "Productivity", "   "],
        service: "shopify_admin",
      }),
    ),
    ["Cross-Border Ecommerce", "Productivity"],
  )
  assert.equal(
    getProviderCategoryRawLabels(provider({ categoryLabels: ["Productivity"], service: "ordinary-provider" })).includes(
      "Cross-Border Ecommerce",
    ),
    false,
  )
})

test("provider search includes localized and legacy aliases", () => {
  const searchable = provider({ displayName: "Feishu", searchAliases: ["飞书", "Lark"] })
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  assert.equal(matchesProviderQuery(searchable, "飞书", t), true)
  assert.equal(matchesProviderQuery(searchable, "lark", t), true)
  assert.equal(matchesProviderQuery(searchable, "slack", t), false)
})

test("buildCredentialSummaryDisplayValues keeps only non-secret display values", () => {
  assert.deepEqual(
    buildCredentialSummaryDisplayValues(
      [
        { key: "apiKey", secret: true },
        { key: "workspace", secret: false },
        { key: "token", secret: true },
      ],
      {
        authType: "api_key",
        fields: {
          apiKey: { configured: true, maskedValue: "sk-***" },
          token: { configured: true, displayValue: "should-not-fill" },
          workspace: { configured: true, displayValue: "prod" },
        },
      },
    ),
    { workspace: "prod" },
  )
})

test("buildFederatedCredentialDisplayValues keeps non-secret known fields", () => {
  assert.deepEqual(
    buildFederatedCredentialDisplayValues(
      [{ key: "roleArn" }, { key: "policy" }],
      [
        { key: "roleArn", label: "Role ARN", displayValue: "role-a", secret: false },
        { key: "policy", label: "Policy", displayValue: "{}", secret: false },
        { key: "token", label: "Token", displayValue: "hidden", secret: true },
        { key: "unknown", label: "Unknown", displayValue: "ignored", secret: false },
      ],
    ),
    { policy: "{}", roleArn: "role-a" },
  )
})

test("getConnectionAppNote trims persisted comments", () => {
  assert.equal(
    getConnectionAppNote({
      authType: "federated",
      comment: " developer role ",
      createdAt: 0,
      id: "app-1",
      isDefault: false,
      service: "aliyun_sts",
      status: "active",
      updatedAt: 0,
    }),
    "developer role",
  )
})

test("normalizeConnectionAliasInput keeps connector-safe connection names", () => {
  assert.equal(normalizeConnectionAliasInput("-- prod role @ aliyun "), "prodrolealiyun")
  assert.equal(normalizeConnectionAliasInput("admin_role-01"), "admin_role-01")
})

test("connection detail cache keys separate workspaces for the same provider", () => {
  const workspaceKey = connectionDetailCacheKey("team:acme", "canva")
  const teamKey = connectionDetailCacheKey("team:Design", "canva")

  assert.notEqual(workspaceKey, teamKey)
})

test("selectVisibleCategoryFilters keeps an active overflow category visible", () => {
  const filters = [
    { count: 12, displayLabel: "Data & Analytics", label: "Data & Analytics" },
    { count: 8, displayLabel: "Productivity", label: "Productivity" },
    { count: 5, displayLabel: "Developer Tools", label: "Developer Tools" },
  ]

  assert.deepEqual(selectVisibleCategoryFilters(filters, null, 2), filters.slice(0, 2))
  assert.deepEqual(selectVisibleCategoryFilters(filters, "Developer Tools", 2), [filters[0], filters[2]])
  assert.deepEqual(selectVisibleCategoryFilters(filters, "Developer Tools", 0), [])
})

test("getFittingCategoryFilterCount reserves space for More categories", () => {
  const filters = [
    { count: 411, displayLabel: "Data & Analytics", label: "Data & Analytics" },
    { count: 356, displayLabel: "Productivity", label: "Productivity" },
    { count: 132, displayLabel: "Developer Tools", label: "Developer Tools" },
    { count: 96, displayLabel: "Communication", label: "Communication" },
  ]
  const categoryFilterWidths = new Map([
    ["Data & Analytics", 266],
    ["Productivity", 220],
    ["Developer Tools", 200],
    ["Communication", 230],
  ])

  assert.equal(
    getFittingCategoryFilterCount({
      availableWidth: 1475,
      baseFilterWidths: [120, 183, 240],
      categoryFilterWidths,
      filters,
      gap: 4,
      moreCategoriesWidth: 260,
      selectedCategory: null,
    }),
    2,
  )
  assert.equal(
    getFittingCategoryFilterCount({
      availableWidth: 1475,
      baseFilterWidths: [120, 183, 240],
      categoryFilterWidths,
      filters,
      gap: 4,
      moreCategoriesWidth: 260,
      selectedCategory: "Developer Tools",
    }),
    2,
  )
})
