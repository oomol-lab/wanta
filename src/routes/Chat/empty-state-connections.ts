import type { ConnectionProvider } from "../../../electron/connections/common.ts"

import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"

export interface EmptyStateConnectionSummary {
  availableCount: number
  needsAttentionCount: number
}

/** 首页只按 Provider 种类计数，避免同一工具的多个账号被误认为多个工具。 */
export function summarizeEmptyStateConnections(
  providers: readonly ConnectionProvider[],
  connectedProviderCount: number,
): EmptyStateConnectionSummary {
  let computedAvailableCount = 0
  let needsAttentionCount = 0

  for (const provider of providers) {
    if (provider.status === "connected" && !isConnectionlessNoAuthProvider(provider)) {
      computedAvailableCount += 1
    } else if (provider.status === "needs_attention") {
      needsAttentionCount += 1
    }
  }

  // connectedProviderCount 已排除免配置 Provider；服务端摘要仍可能覆盖未出现在当前目录页中的真实连接。
  const availableCount = Math.max(computedAvailableCount, connectedProviderCount - needsAttentionCount, 0)
  return { availableCount, needsAttentionCount }
}
