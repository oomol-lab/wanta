import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ConnectionCatalogFilter } from "../Connections/connection-route-model.ts"
import type { MessageKey } from "@/i18n/i18n"

import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"

export interface EmptyStateConnectionSummary {
  availableCount: number
  needsAttentionCount: number
}

export interface CurrentToolsPresentation {
  actionKey: MessageKey
  ariaLabelKey: MessageKey
  highlighted: boolean
  targetFilter: ConnectionCatalogFilter
  meta: { key: MessageKey; vars?: Record<string, string | number> }
  titleKey: MessageKey
}

/** 集中推导首页当前工具入口，确保文案、状态与无障碍描述使用同一组条件。 */
export function resolveCurrentToolsPresentation(
  workspaceType: "organization" | "personal",
  connectionSummary: EmptyStateConnectionSummary | null | undefined,
): CurrentToolsPresentation {
  const hasConnectionIssue = Boolean(connectionSummary?.needsAttentionCount)
  const hasCurrentTools = Boolean(
    connectionSummary && connectionSummary.availableCount + connectionSummary.needsAttentionCount > 0,
  )
  const meta: CurrentToolsPresentation["meta"] = connectionSummary
    ? connectionSummary.needsAttentionCount > 0
      ? {
          key: "chat.emptyCurrentConnectorsAttentionMeta" as const,
          vars: {
            available: connectionSummary.availableCount,
            attention: connectionSummary.needsAttentionCount,
          },
        }
      : connectionSummary.availableCount > 0
        ? {
            key: "chat.emptyCurrentConnectorsMeta" as const,
            vars: { count: connectionSummary.availableCount },
          }
        : { key: "chat.emptyCurrentConnectorsEmptyMeta" as const }
    : connectionSummary === null
      ? { key: "chat.emptyCurrentConnectorsUnavailableMeta" as const }
      : { key: "chat.emptyCurrentConnectorsLoadingMeta" as const }

  return {
    actionKey: hasConnectionIssue
      ? "chat.emptyCurrentConnectorsCheckAction"
      : workspaceType === "organization"
        ? "chat.emptySharedConnectorsAction"
        : hasCurrentTools
          ? "chat.emptyPersonalConnectorsManageAction"
          : "chat.emptyPersonalConnectorsConnectAction",
    ariaLabelKey:
      workspaceType === "organization"
        ? hasConnectionIssue
          ? "chat.emptySharedConnectorsAttentionAria"
          : "chat.emptySharedConnectorsAria"
        : "chat.emptyPersonalConnectorsAria",
    highlighted: hasConnectionIssue,
    targetFilter: hasConnectionIssue
      ? { kind: "attention" }
      : hasCurrentTools
        ? { kind: "available-tools" }
        : { kind: "all" },
    meta,
    titleKey:
      workspaceType === "organization" ? "chat.emptySharedConnectorsTitle" : "chat.emptyPersonalConnectorsTitle",
  }
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
    } else if (provider.status === "needs_attention" && !isConnectionlessNoAuthProvider(provider)) {
      needsAttentionCount += 1
    }
  }

  // 服务端计数不含免配置 Provider，但可能覆盖未出现在当前目录页中的真实连接。
  // 两者取较大值，让首页同时体现真实连接和当前目录中可直接使用的工具。
  const availableCount = Math.max(computedAvailableCount, connectedProviderCount - needsAttentionCount, 0)
  return { availableCount, needsAttentionCount }
}
