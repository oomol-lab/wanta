import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"

export const recommendedConnectionServicePriority = [
  "gmail",
  "googlesheets",
  "googlecalendar",
  "googledrive",
  "github",
  "slack",
  "notion",
  "googledocs",
  "airtable",
  "trello",
  "jira",
  "linear",
  "asana",
  "clickup",
  "hubspot",
  "googleforms",
  "googleslides",
  "dropbox",
  "confluence",
  "outlook",
  "discord",
  "telegram",
  "stripe",
  "shopify",
  "googleanalytics",
  "googlesearchconsole",
  "openai",
  "anthropic",
  "gemini",
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
    getRecommendedConnectionServicePriority(left.service) - getRecommendedConnectionServicePriority(right.service) ||
    compareProviderNames(left, right) ||
    left.service.localeCompare(right.service)
  )
}

function compareProviderNames(left: ConnectionProviderSummary, right: ConnectionProviderSummary): number {
  return (
    Number(!hanCharacterPattern.test(left.displayName)) - Number(!hanCharacterPattern.test(right.displayName)) ||
    providerNameCollator.compare(left.displayName, right.displayName)
  )
}

export function getRecommendedConnectionServicePriority(service: string): number {
  return recommendedConnectionServicePriorityMap.get(compactConnectionService(service)) ?? Number.MAX_SAFE_INTEGER
}

function getConnectionProviderStatusWeight(provider: ConnectionProviderSummary): number {
  if (provider.status === "needs_attention") {
    return 0
  }
  if (provider.status === "connected") {
    return isConnectionlessNoAuthProvider(provider) ? 2 : 1
  }
  return 2
}

export function compactConnectionService(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "")
}
