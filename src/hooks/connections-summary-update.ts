import type { ConnectionAppSummary, ConnectionSummary } from "../../electron/connections/common.ts"

import { connectionAppDisplayLabel } from "../../electron/connections/summary.ts"

function mergeUpdatedApp(app: ConnectionAppSummary, updatedApp: ConnectionAppSummary | null): ConnectionAppSummary {
  if (!updatedApp || app.id !== updatedApp.id) {
    return app
  }
  return { ...app, ...updatedApp }
}

function applyDefaultFlag(
  app: ConnectionAppSummary,
  service: string,
  appId: string,
  updatedApp: ConnectionAppSummary | null,
): ConnectionAppSummary {
  if (app.service !== service) {
    return app
  }
  const merged = mergeUpdatedApp(app, updatedApp)
  return merged.id === appId ? { ...merged, isDefault: true } : { ...merged, isDefault: false }
}

function pickProviderDisplayApp(apps: ConnectionAppSummary[], appId: string): ConnectionAppSummary | undefined {
  return (
    apps.find((app) => app.id === appId) ??
    apps.find((app) => app.isDefault) ??
    (apps.length === 1 ? apps[0] : undefined)
  )
}

export function applyDefaultAccountUpdate(
  summary: ConnectionSummary,
  service: string,
  appId: string,
  updatedApp: ConnectionAppSummary | null,
): ConnectionSummary {
  const apps = summary.apps.map((app) => applyDefaultFlag(app, service, appId, updatedApp))
  const providers = summary.providers.map((provider) => {
    if (provider.service !== service) {
      return provider
    }
    const providerApps = provider.apps.map((app) => applyDefaultFlag(app, service, appId, updatedApp))
    const displayApp = pickProviderDisplayApp(providerApps, appId)
    return {
      ...provider,
      accountLabel: displayApp ? connectionAppDisplayLabel(displayApp) : provider.accountLabel,
      appAuthType: displayApp?.authType ?? provider.appAuthType,
      appId: displayApp?.id ?? provider.appId,
      appStatus: displayApp?.status ?? provider.appStatus,
      apps: providerApps,
    }
  })
  return { ...summary, apps, providers }
}
