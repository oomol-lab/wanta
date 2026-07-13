import type { ConnectionProvider } from "../../../electron/connections/common.ts"

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
    if (provider.status === "connected") {
      computedAvailableCount += 1
    } else if (provider.status === "needs_attention") {
      needsAttentionCount += 1
    }
  }

  // 服务端摘要可能覆盖未出现在当前目录页中的连接，不能因前端目录不完整而把真实总数显示少。
  const availableCount = Math.max(computedAvailableCount, connectedProviderCount - needsAttentionCount, 0)
  return { availableCount, needsAttentionCount }
}
