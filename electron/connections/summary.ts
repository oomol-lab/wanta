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
} from "./common.ts"

import { createEmptyConnectionSummary } from "./summary-model.ts"

export interface RawApp {
  accountLabel?: unknown
  authType?: unknown
  displayName?: unknown
  id?: unknown
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
    accountLabel: asString(item.accountLabel) ?? asString(item.displayName),
    authType: normalizeAuthType(item.authType),
    status: normalizeAppStatus(item.status),
    updatedAt: asNumber(item.updatedAt) ?? 0,
  }
}

export function normalizeProvider(
  item: RawProvider,
  appsByService: Map<string, ConnectionAppSummary>,
): ConnectionProviderSummary | undefined {
  const service = asString(item.service)
  if (!service) {
    return undefined
  }

  const app = appsByService.get(service)
  const status: ConnectionProviderStatus =
    app?.status === "reauth_required" || app?.status === "error"
      ? "needs_attention"
      : app?.status === "active"
        ? "connected"
        : "available"
  const normalizedAuthTypes = normalizeAuthTypes(item.authTypes)
  const isPureNoAuthProvider = normalizedAuthTypes.length === 1 && normalizedAuthTypes[0] === "no_auth"

  return {
    service,
    status,
    accountLabel: app?.accountLabel,
    appId: app?.id,
    appAuthType: app?.authType,
    appStatus: app?.status,
    actionKind: getProviderActionKind(normalizedAuthTypes),
    authTypes: normalizedAuthTypes,
    canDisconnect: Boolean(app) && !isPureNoAuthProvider,
    categoryLabels: normalizeCategories(item.categories),
    connectedUpdatedAt: app?.updatedAt,
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
}: {
  apps: RawApp[]
  meta?: RawAppListMeta | null
  providers: RawProvider[]
  usage: ConnectionUsageSummary
}): ConnectionSummary {
  const apps = rawApps.map(normalizeApp).filter((app): app is ConnectionAppSummary => Boolean(app))
  const visibleApps = apps.filter((app) => app.status !== "disconnected")
  const appsByService = new Map(visibleApps.map((app) => [app.service, app] as const))
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
    ...createEmptyConnectionSummary("ready"),
    activeConnections: visibleApps.filter((app) => app.status === "active").length,
    apps: visibleApps,
    connectedProviderCount: asNumber(appListSummary?.connectedProviderCount) ?? visibleApps.length,
    connectableProviderCount: asNumber(appListSummary?.connectableProviderCount) ?? 0,
    needsAttention: visibleApps.filter((app) => app.status === "reauth_required" || app.status === "error").length,
    providerCount,
    providers,
    usage,
    updatedAt: new Date().toISOString(),
  }
}
