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

const recommendedConnectionServicePriorityMap = new Map(
  recommendedConnectionServicePriority.map((service, index) => [compactServiceValue(service), index]),
)

export function compareConnectionProvidersByRecommendation(
  left: ConnectionProviderSummary,
  right: ConnectionProviderSummary,
): number {
  return (
    getConnectionProviderStatusWeight(left) - getConnectionProviderStatusWeight(right) ||
    getRecommendedConnectionServicePriority(left.service) - getRecommendedConnectionServicePriority(right.service) ||
    left.displayName.localeCompare(right.displayName) ||
    left.service.localeCompare(right.service)
  )
}

export function getRecommendedConnectionServicePriority(service: string): number {
  return recommendedConnectionServicePriorityMap.get(compactServiceValue(service)) ?? Number.MAX_SAFE_INTEGER
}

function getConnectionProviderStatusWeight(provider: ConnectionProviderSummary): number {
  if (provider.status === "needs_attention") {
    return 0
  }
  if (provider.status === "connected") {
    return isConnectionlessNoAuthProvider(provider) ? 3 : 1
  }
  return 2
}

function compactServiceValue(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "")
}
