import type {
  ConnectionAppStatus,
  ConnectionAppSummary,
  ConnectionAuthType,
  ConnectionCredentialField,
  ConnectionProviderActionKind,
  ConnectionProviderDetail,
  ConnectionProviderStatus,
  ConnectionProviderSummary,
  ConnectionSummary,
  ConnectionUsageSummary,
  ConnectionWorkspace,
} from "./common.ts"

import { createEmptyConnectionSummary } from "./summary-model.ts"

export interface RawApp {
  accountLabel?: unknown
  alias?: unknown
  authType?: unknown
  createdAt?: unknown
  displayName?: unknown
  id?: unknown
  isDefault?: unknown
  providerAccountId?: unknown
  service?: unknown
  status?: unknown
  updatedAt?: unknown
}

export interface RawProvider {
  apiKeyConfig?: unknown
  authTypes?: unknown
  categories?: unknown
  customCredentialConfig?: unknown
  displayName?: unknown
  federatedCredentialConfig?: unknown
  homepageUrl?: unknown
  icon?: unknown
  iconUrl?: unknown
  service?: unknown
}

export interface RawAppListSummary {
  activeConnectedProviderCount?: unknown
  connectableProviderCount?: unknown
  connectedProviderCount?: unknown
  providerCount?: unknown
}

export interface RawAppListMeta {
  summary?: RawAppListSummary
}

interface RawProviderCategory {
  displayName?: unknown
  id?: unknown
}

interface RawCredentialField {
  description?: unknown
  key?: unknown
  label?: unknown
  placeholder?: unknown
  required?: unknown
  secret?: unknown
}

interface RawApiKeyConfig {
  description?: unknown
  extraFields?: unknown
  label?: unknown
  placeholder?: unknown
}

interface RawCustomCredentialConfig {
  fields?: unknown
}

const appStatuses = new Set<ConnectionAppStatus>(["active", "reauth_required", "error", "disconnected"])
const authTypes = new Set<Exclude<ConnectionAuthType, null>>([
  "oauth2",
  "api_key",
  "custom_credential",
  "federated",
  "no_auth",
])

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizeAppStatus(value: unknown): ConnectionAppStatus {
  return typeof value === "string" && appStatuses.has(value as ConnectionAppStatus)
    ? (value as ConnectionAppStatus)
    : "error"
}

function normalizeAuthType(value: unknown): ConnectionAuthType {
  return typeof value === "string" && authTypes.has(value as Exclude<ConnectionAuthType, null>)
    ? (value as Exclude<ConnectionAuthType, null>)
    : null
}

function normalizeAuthTypes(value: unknown): Exclude<ConnectionAuthType, null>[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is Exclude<ConnectionAuthType, null> => {
    return typeof item === "string" && authTypes.has(item as Exclude<ConnectionAuthType, null>)
  })
}

function normalizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined
      }

      const category = item as RawProviderCategory
      return asString(category.displayName) ?? asString(category.id)
    })
    .filter((item): item is string => Boolean(item))
}

function isVirtualNoAuthApp(app: Pick<ConnectionAppSummary, "id">): boolean {
  return app.id.startsWith("no_auth:")
}

function isManageableApp(app: ConnectionAppSummary): boolean {
  return !isVirtualNoAuthApp(app) && app.status !== "disconnected"
}

function getManageableApps(apps: ConnectionAppSummary[]): ConnectionAppSummary[] {
  return apps.filter(isManageableApp)
}

function getAppDisplayName(app: ConnectionAppSummary): string {
  return app.displayName || app.alias || app.accountLabel || app.providerAccountId || app.id
}

function pickDefaultOrSingleApp(apps: ConnectionAppSummary[]): ConnectionAppSummary | undefined {
  const candidates = getManageableApps(apps)
  return candidates.find((app) => app.isDefault) ?? (candidates.length === 1 ? candidates[0] : undefined)
}

function pickStatusApp(apps: ConnectionAppSummary[]): ConnectionAppSummary | undefined {
  const candidates = getManageableApps(apps)
  return (
    pickDefaultOrSingleApp(candidates) ??
    candidates.find((app) => app.status === "active") ??
    candidates[0] ??
    undefined
  )
}

function latestUpdatedAt(apps: ConnectionAppSummary[]): number | undefined {
  const values = apps.map((app) => app.updatedAt).filter((value) => value > 0)
  return values.length > 0 ? Math.max(...values) : undefined
}

export function normalizeCredentialField(item: unknown, secretFallback = false): ConnectionCredentialField | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined
  }

  const field = item as RawCredentialField
  const key = asString(field.key)
  const label = asString(field.label)

  if (!key || !label) {
    return undefined
  }

  return {
    key,
    label,
    description: asString(field.description),
    placeholder: asString(field.placeholder),
    required: field.required === true,
    secret: typeof field.secret === "boolean" ? field.secret : secretFallback,
  }
}

export function normalizeApiKeyConfig(value: unknown): ConnectionProviderDetail["apiKeyConfig"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const config = value as RawApiKeyConfig
  const extraFields = Array.isArray(config.extraFields)
    ? config.extraFields
        .map((field) => normalizeCredentialField(field))
        .filter((field): field is ConnectionCredentialField => Boolean(field))
    : []

  return {
    extraFields,
    description: asString(config.description),
    label: asString(config.label),
    placeholder: asString(config.placeholder),
  }
}

export function normalizeCustomCredentialConfig(value: unknown): ConnectionProviderDetail["customCredentialConfig"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const config = value as RawCustomCredentialConfig
  return {
    fields: Array.isArray(config.fields)
      ? config.fields
          .map((field) => normalizeCredentialField(field))
          .filter((field): field is ConnectionCredentialField => Boolean(field))
      : [],
  }
}

function getProviderActionKind(authTypes: Exclude<ConnectionAuthType, null>[]): ConnectionProviderActionKind {
  if (authTypes.includes("oauth2")) {
    return "oauth2"
  }
  if (authTypes.includes("api_key")) {
    return "api_key"
  }
  if (authTypes.includes("custom_credential")) {
    return "custom_credential"
  }
  if (authTypes.includes("no_auth")) {
    return "no_auth"
  }
  if (authTypes.includes("federated")) {
    return "federated"
  }
  return "unavailable"
}

export function normalizeApp(item: RawApp): ConnectionAppSummary | undefined {
  const id = asString(item.id)
  const service = asString(item.service)

  if (!id || !service) {
    return undefined
  }

  return {
    id,
    service,
    alias: asString(item.alias),
    accountLabel: asString(item.accountLabel) ?? asString(item.displayName),
    authType: normalizeAuthType(item.authType),
    createdAt: asNumber(item.createdAt) ?? 0,
    displayName: asString(item.displayName),
    isDefault: item.isDefault === true,
    providerAccountId: asString(item.providerAccountId),
    status: normalizeAppStatus(item.status),
    updatedAt: asNumber(item.updatedAt) ?? 0,
  }
}

export function normalizeProvider(
  item: RawProvider,
  appsByService: Map<string, ConnectionAppSummary[]>,
): ConnectionProviderSummary | undefined {
  const service = asString(item.service)
  if (!service) {
    return undefined
  }

  const apps = appsByService.get(service) ?? []
  const manageableApps = getManageableApps(apps)
  const app = pickStatusApp(manageableApps)
  const hasNoAuthReadyApp = apps.some(
    (candidate) => isVirtualNoAuthApp(candidate) && candidate.status !== "disconnected",
  )
  const status: ConnectionProviderStatus = manageableApps.some(
    (candidate) => candidate.status === "reauth_required" || candidate.status === "error",
  )
    ? "needs_attention"
    : manageableApps.some((candidate) => candidate.status === "active") || hasNoAuthReadyApp
      ? "connected"
      : "available"
  const normalizedAuthTypes = normalizeAuthTypes(item.authTypes)
  const isPureNoAuthProvider = normalizedAuthTypes.length === 1 && normalizedAuthTypes[0] === "no_auth"

  return {
    service,
    status,
    accountLabel: app ? getAppDisplayName(app) : undefined,
    appId: app?.id,
    appAuthType: app?.authType,
    appStatus: app?.status,
    appCount: manageableApps.length,
    apps: manageableApps,
    actionKind: getProviderActionKind(normalizedAuthTypes),
    authTypes: normalizedAuthTypes,
    canDisconnect: manageableApps.length > 0 && !isPureNoAuthProvider,
    categoryLabels: normalizeCategories(item.categories),
    connectedUpdatedAt: latestUpdatedAt(manageableApps),
    displayName: asString(item.displayName) ?? service,
    iconUrl: asString(item.iconUrl) ?? asString(item.icon),
  }
}

export function sortConnectionProviders(left: ConnectionProviderSummary, right: ConnectionProviderSummary): number {
  function getWeight(provider: ConnectionProviderSummary): number {
    const isNoAuthProvider =
      provider.appAuthType === "no_auth" || provider.authTypes.every((authType) => authType === "no_auth")

    if (provider.status === "needs_attention") {
      return 0
    }

    if (provider.status === "connected") {
      return isNoAuthProvider ? 2 : 1
    }

    return isNoAuthProvider ? 4 : 3
  }

  return getWeight(left) - getWeight(right) || left.displayName.localeCompare(right.displayName)
}

export function mergeConnectionSummary({
  apps: rawApps,
  meta,
  providers: rawProviders,
  usage,
  workspace,
}: {
  apps: RawApp[]
  meta?: RawAppListMeta | null
  providers: RawProvider[]
  usage: ConnectionUsageSummary
  workspace?: ConnectionWorkspace
}): ConnectionSummary {
  const apps = rawApps.map(normalizeApp).filter((app): app is ConnectionAppSummary => Boolean(app))
  const visibleApps = apps.filter((app) => app.status !== "disconnected")
  const appsByService = new Map<string, ConnectionAppSummary[]>()
  for (const app of visibleApps) {
    const current = appsByService.get(app.service) ?? []
    current.push(app)
    appsByService.set(app.service, current)
  }
  const providers = rawProviders
    .map((provider) => normalizeProvider(provider, appsByService))
    .filter((provider): provider is ConnectionProviderSummary => Boolean(provider))
    .sort(sortConnectionProviders)
  const appListSummary = meta?.summary
  const providerCount = asNumber(appListSummary?.providerCount) ?? rawProviders.length

  if (providers.length === 0 && providerCount > 0) {
    throw new Error("Connector provider catalog returned no usable providers.")
  }

  return {
    ...createEmptyConnectionSummary("ready", undefined, workspace),
    activeConnections: visibleApps.filter((app) => app.status === "active").length,
    apps: visibleApps,
    connectedProviderCount:
      asNumber(appListSummary?.connectedProviderCount) ??
      providers.filter((provider) => provider.status === "connected" || provider.status === "needs_attention").length,
    connectableProviderCount: asNumber(appListSummary?.connectableProviderCount) ?? 0,
    needsAttention: visibleApps.filter((app) => app.status === "reauth_required" || app.status === "error").length,
    providerCount,
    providers,
    usage,
    updatedAt: new Date().toISOString(),
  }
}
