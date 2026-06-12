import type { ConnectionAuthType, ConnectionProvider, ConnectionSummary } from "./common.ts"

export interface RawApp {
  id?: string
  service: string
  status?: string
  authType?: ConnectionAuthType | null
  accountLabel?: string
  displayName?: string
  updatedAt?: number
}

export interface RawProvider {
  service: string
  displayName?: string
  iconUrl?: string
  categories?: Array<{ id?: string; displayName?: string }>
  authTypes?: ConnectionAuthType[]
}

/** 合并 /v1/apps（已连接）与 /v1/providers（目录）为 ConnectionSummary。纯函数，便于离线测试。 */
export function mergeConnectionSummary(apps: RawApp[], providers: RawProvider[], now: number): ConnectionSummary {
  const appByService = new Map<string, RawApp>()
  for (const app of apps) {
    appByService.set(app.service, app)
  }

  const merged: ConnectionProvider[] = providers.map((provider) => {
    const app = appByService.get(provider.service)
    const authTypes = provider.authTypes ?? []
    const isNoAuthOnly = authTypes.length === 1 && authTypes[0] === "no_auth"
    const connected = app?.status === "active"
    const status: ConnectionProvider["status"] = connected ? "connected" : app ? "needs_attention" : "available"
    return {
      service: provider.service,
      displayName: provider.displayName ?? provider.service,
      iconUrl: provider.iconUrl,
      categories: (provider.categories ?? []).map((c) => c.displayName ?? c.id ?? "").filter(Boolean),
      authTypes,
      status,
      connected,
      appStatus: app?.status,
      accountLabel: app?.accountLabel ?? app?.displayName,
      updatedAt: app?.updatedAt,
      // 纯 no_auth provider 后端不允许断开。
      canDisconnect: connected && !isNoAuthOnly,
    }
  })

  const rank = (p: ConnectionProvider): number => (p.status === "needs_attention" ? 0 : p.connected ? 1 : 2)
  merged.sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName))

  return {
    providers: merged,
    connectedCount: merged.filter((p) => p.connected).length,
    providerCount: merged.length,
    ready: true,
    updatedAt: now,
  }
}

export function emptyConnectionSummary(now: number, message?: string): ConnectionSummary {
  return { providers: [], connectedCount: 0, providerCount: 0, ready: false, message, updatedAt: now }
}
