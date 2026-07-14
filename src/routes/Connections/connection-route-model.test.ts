import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildCredentialSummaryDisplayValues,
  buildFederatedCredentialDisplayValues,
  connectionDetailCacheKey,
  getConnectionAppNote,
  getFittingCategoryFilterCount,
  getProviderAccountValue,
  getProviderActionLabel,
  getProviderMeta,
  getProviderStatusDisplayLabel,
  getProviderStatusTone,
  isConnectionDetailCacheKeyForService,
  isConnected,
  isDirectlyAvailableProvider,
  isUsableProvider,
  matchesProviderFilter,
  normalizeConnectionAliasInput,
  parseFilterValue,
  selectVisibleCategoryFilters,
  shouldLoadProviderDetail,
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
  assert.equal(isUsableProvider(ready), true)
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
    "Ready to use",
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
  assert.equal(isUsableProvider(ready), true)
  assert.equal(shouldLoadProviderDetail(ready), true)
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
  assert.equal(isUsableProvider(ready), true)
  assert.equal(shouldLoadProviderDetail(ready), true)
  assert.equal(matchesProviderFilter(ready, { kind: "directly-available" }), true)
  assert.equal(matchesProviderFilter(ready, { kind: "usable" }), true)
  assert.equal(getProviderStatusTone(ready), "directly-available")
  assert.equal(getProviderActionLabel(ready, t), "Ready to use")
})

test("availability catalog filters round trip", () => {
  assert.deepEqual(parseFilterValue("directly-available"), { kind: "directly-available" })
  assert.deepEqual(parseFilterValue("usable"), { kind: "usable" })
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
  const personalKey = connectionDetailCacheKey("personal", "canva")
  const organizationKey = connectionDetailCacheKey("organization:Design", "canva")

  assert.notEqual(personalKey, organizationKey)
  assert.equal(isConnectionDetailCacheKeyForService(personalKey, "canva"), true)
  assert.equal(isConnectionDetailCacheKeyForService(organizationKey, "canva"), true)
  assert.equal(isConnectionDetailCacheKeyForService(organizationKey, "gmail"), false)
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
