import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { isUserManagedCredentialApp } from "../../../electron/connections/summary.ts"
import { getMarketplacePriceReduction } from "./connection-provider-pricing.ts"

export const recommendedConnectionServicePriority = [
  "googlesheets",
  "gmail",
  "slack",
  "googlecalendar",
  "googledrive",
  "github",
  "notion",
  "hubspot",
  "googleforms",
  "airtable",
  "trello",
  "asana",
  "jira",
  "linear",
  "clickup",
  "monday",
  "googledocs",
  "googleslides",
  "dropbox",
  "box",
  "confluence",
  "outlook",
  "discord",
  "telegram",
  "twilio",
  "sendgrid",
  "mailchimp",
  "shopify",
  "stripe",
  "googleanalytics",
  "googlesearchconsole",
  "facebookleadads",
  "metaads",
  "linkedin",
  "salesforce",
  "pipedrive",
  "zendesk",
  "intercom",
  "openai",
  "anthropic",
  "gemini",
  "perplexity",
  "deepseek",
  "gitlab",
  "dockerhub",
  "vercel",
  "cloudflareworker",
  "awss3",
  "cloudflarer2",
  "googlebigquery",
] as const

export type ConnectionProviderSortMode = "name" | "recently-connected" | "recommended"

const providerNameCollator = new Intl.Collator(["zh-CN", "en"], {
  numeric: true,
  sensitivity: "base",
})
const hanCharacterPattern = /\p{Script=Han}/u

export function compareConnectionProviders(
  left: ConnectionProviderSummary,
  right: ConnectionProviderSummary,
  mode: ConnectionProviderSortMode,
): number {
  if (mode === "name") return compareProviderNames(left, right)
  if (mode === "recently-connected") {
    return (right.connectedUpdatedAt ?? 0) - (left.connectedUpdatedAt ?? 0) || compareProviderNames(left, right)
  }
  return compareConnectionProvidersByRecommendation(left, right)
}

const recommendedConnectionServicePriorityMap = new Map(
  recommendedConnectionServicePriority.map((service, index) => [compactConnectionService(service), index]),
)

export function compareConnectionProvidersByRecommendation(
  left: ConnectionProviderSummary,
  right: ConnectionProviderSummary,
): number {
  return (
    getConnectionProviderStatusWeight(left) - getConnectionProviderStatusWeight(right) ||
    getProviderLanguageGroup(left) - getProviderLanguageGroup(right) ||
    getRecommendedConnectionServicePriority(left.service) - getRecommendedConnectionServicePriority(right.service) ||
    compareProviderNames(left, right) ||
    left.service.localeCompare(right.service)
  )
}

function compareProviderNames(left: ConnectionProviderSummary, right: ConnectionProviderSummary): number {
  return (
    getProviderLanguageGroup(left) - getProviderLanguageGroup(right) ||
    providerNameCollator.compare(left.displayName, right.displayName)
  )
}

export function getRecommendedConnectionServicePriority(service: string): number {
  return recommendedConnectionServicePriorityMap.get(compactConnectionService(service)) ?? Number.MAX_SAFE_INTEGER
}

function getProviderLanguageGroup(provider: ConnectionProviderSummary): number {
  return Number(!hanCharacterPattern.test(provider.displayName))
}

function getConnectionProviderStatusWeight(provider: ConnectionProviderSummary): number {
  const ownApps = provider.apps.filter(isUserManagedCredentialApp)
  const configuredDirect = provider.executionMode === "direct" && provider.status !== "available"
  if (ownApps.length > 0 || configuredDirect) {
    const selectedAppIsOwn = ownApps.some((app) => app.id === provider.appId)
    const selectedStatus = selectedAppIsOwn || configuredDirect ? provider.appStatus : undefined
    if (ownApps.some((app) => app.status === "error") || selectedStatus === "error") return 0
    if (ownApps.some((app) => app.status === "reauth_required") || selectedStatus === "reauth_required") return 1
    if (configuredDirect && provider.status === "needs_attention") return 1
    return 2
  }
  return getMarketplacePriceReduction(provider.service, provider.apps) !== undefined ? 3 : 4
}

export function compactConnectionService(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "")
}
