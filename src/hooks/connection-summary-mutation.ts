import type { ConnectionSummary } from "../../electron/connections/common.ts"

import {
  getProviderConnectionState,
  isConnectionlessNoAuthProvider,
  isUserManagedCredentialApp,
} from "../../electron/connections/summary.ts"

export type ConfirmedConnectionMutation =
  | { kind: "disconnectService"; service: string }
  | { kind: "disconnectAccount"; appId: string }
  | { kind: "alias"; appId: string; alias: string }
  | { kind: "default"; service: string; appId: string }

/** Apply only server-confirmed writes; public provider metadata keeps its identity. */
export function applyConfirmedConnectionMutation(
  summary: ConnectionSummary,
  mutation: ConfirmedConnectionMutation,
): ConnectionSummary {
  const service =
    "service" in mutation ? mutation.service : summary.apps.find((app) => app.id === mutation.appId)?.service
  if (!service) return summary
  const apps = summary.apps.flatMap((app) => {
    if (app.service !== service) return [app]
    switch (mutation.kind) {
      case "disconnectService":
        return isUserManagedCredentialApp(app) ? [] : [app]
      case "disconnectAccount":
        return app.id === mutation.appId ? [] : [app]
      case "alias":
        return app.id === mutation.appId ? [{ ...app, alias: mutation.alias.trim() || undefined }] : [app]
      case "default":
        return [{ ...app, isDefault: app.id === mutation.appId }]
    }
  })
  const serviceApps = apps.filter((app) => app.service === service)
  let countDelta = 0
  const providers = summary.providers.map((provider) => {
    if (provider.service !== service) return provider
    const next = { ...provider, ...getProviderConnectionState(provider.authTypes, serviceApps) }
    const wasConnected = provider.status !== "available" && !isConnectionlessNoAuthProvider(provider)
    const isConnected = next.status !== "available" && !isConnectionlessNoAuthProvider(next)
    countDelta += Number(isConnected) - Number(wasConnected)
    return next
  })
  return {
    ...summary,
    apps,
    providers,
    connectedProviderCount: Math.max(0, summary.connectedProviderCount + countDelta),
  }
}
