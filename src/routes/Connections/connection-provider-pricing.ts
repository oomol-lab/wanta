import type { ConnectionAppSummary } from "../../../electron/connections/common.ts"

// Savings against official pricing, kept aligned with Console's marketplace offers.
const marketplacePriceReductions = new Map([
  ["kling", 30],
  ["seedance", 10],
  ["minimax", 10],
])

export function getMarketplacePriceReduction(service: string, apps: ConnectionAppSummary[]): number | undefined {
  if (!apps.some((app) => app.service === service && app.status === "active" && app.marketplace?.id === "oomol")) {
    return undefined
  }
  return marketplacePriceReductions.get(service)
}
