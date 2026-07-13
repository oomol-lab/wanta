import type {
  ConnectionAppCredentialField,
  ConnectionAppDetail,
  ConnectionAppStatus,
  ConnectionAppSummary,
  ConnectionAuthType,
  ConnectionCredentialField,
  ConnectionCredentialSummary,
  ConnectionOAuthClientConfigFieldDefinition,
  ConnectionOAuthClientConfigNextConnectSource,
  ConnectionOAuthClientConfigPolicy,
  ConnectionOAuthTokenEndpointAuthMethod,
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
  comment?: unknown
  createdAt?: unknown
  credentialFields?: unknown
  credentialSummary?: unknown
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
  oauthClientConfig?: unknown
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

interface RawOAuthClientConfig {
  clientConfigFields?: unknown
  clientConfigPolicy?: unknown
  configured?: unknown
  nextConnectSource?: unknown
  oauthScopes?: unknown
  service?: unknown
  tokenEndpointAuthMethod?: unknown
}

interface RawOAuthClientConfigField {
  connectOnly?: unknown
  defaultValue?: unknown
  description?: unknown
  inputType?: unknown
  key?: unknown
  label?: unknown
  location?: unknown
  placeholder?: unknown
  required?: unknown
  secret?: unknown
}

interface RawCredentialField {
  description?: unknown
  key?: unknown
  label?: unknown
  placeholder?: unknown
  required?: unknown
  secret?: unknown
  valueType?: unknown
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

interface RawFederatedCredentialConfig {
  fields?: unknown
}

interface RawAppCredentialField {
  displayValue?: unknown
  key?: unknown
  label?: unknown
  secret?: unknown
}

interface RawCredentialFieldSummary {
  configured?: unknown
  displayValue?: unknown
  maskedValue?: unknown
}

interface RawCredentialSummary {
  authType?: unknown
  fields?: unknown
}

const appStatuses = new Set<ConnectionAppStatus>(["active", "reauth_required", "error", "disconnected"])
const oauthClientConfigPolicies = new Set<ConnectionOAuthClientConfigPolicy>(["default_only", "user_required"])
const oauthClientConfigNextConnectSources = new Set<ConnectionOAuthClientConfigNextConnectSource>([
  "custom",
  "default",
  "unconfigured",
])
const oauthTokenEndpointAuthMethods = new Set<ConnectionOAuthTokenEndpointAuthMethod>([
  "client_secret_basic",
  "client_secret_post",
  "none",
])
const oauthClientConfigFieldInputTypes = new Set<ConnectionOAuthClientConfigFieldDefinition["inputType"]>([
  "password",
  "string_array",
  "text",
  "textarea",
])
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
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

function normalizeOAuthClientConfigPolicy(value: unknown): ConnectionOAuthClientConfigPolicy {
  return typeof value === "string" && oauthClientConfigPolicies.has(value as ConnectionOAuthClientConfigPolicy)
    ? (value as ConnectionOAuthClientConfigPolicy)
    : "default_only"
}

function normalizeOAuthClientConfigNextConnectSource(value: unknown): ConnectionOAuthClientConfigNextConnectSource {
  return typeof value === "string" &&
    oauthClientConfigNextConnectSources.has(value as ConnectionOAuthClientConfigNextConnectSource)
    ? (value as ConnectionOAuthClientConfigNextConnectSource)
    : "unconfigured"
}

function normalizeOAuthTokenEndpointAuthMethod(value: unknown): ConnectionOAuthTokenEndpointAuthMethod {
  return typeof value === "string" && oauthTokenEndpointAuthMethods.has(value as ConnectionOAuthTokenEndpointAuthMethod)
    ? (value as ConnectionOAuthTokenEndpointAuthMethod)
    : "client_secret_post"
}

function normalizeOAuthClientConfigField(item: unknown): ConnectionOAuthClientConfigFieldDefinition | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined
  }

  const field = item as RawOAuthClientConfigField
  const key = asString(field.key)
  const label = asString(field.label)
  if (!key || !label) {
    return undefined
  }

  const inputType =
    typeof field.inputType === "string" &&
    oauthClientConfigFieldInputTypes.has(field.inputType as ConnectionOAuthClientConfigFieldDefinition["inputType"])
      ? (field.inputType as ConnectionOAuthClientConfigFieldDefinition["inputType"])
      : field.secret === true
        ? "password"
        : "text"

  const location = field.location === "secretExtra" ? "secretExtra" : "extra"
  const defaultValue =
    typeof field.defaultValue === "string"
      ? field.defaultValue
      : Array.isArray(field.defaultValue)
        ? field.defaultValue.filter((item): item is string => typeof item === "string")
        : undefined

  return {
    key,
    label,
    inputType,
    location,
    required: field.required === true,
    secret: location === "secretExtra" || field.secret === true || inputType === "password",
    connectOnly: field.connectOnly === true,
    defaultValue,
    description: asString(field.description),
    placeholder: asString(field.placeholder),
  }
}

export function normalizeOAuthClientConfig(
  value: unknown,
  serviceFallback?: string,
): ConnectionProviderDetail["oauthClientConfig"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const config = value as RawOAuthClientConfig
  const service = asString(config.service) ?? serviceFallback
  if (!service) {
    return null
  }

  return {
    service,
    clientConfigFields: Array.isArray(config.clientConfigFields)
      ? config.clientConfigFields
          .map((field) => normalizeOAuthClientConfigField(field))
          .filter((field): field is ConnectionOAuthClientConfigFieldDefinition => Boolean(field))
      : [],
    clientConfigPolicy: normalizeOAuthClientConfigPolicy(config.clientConfigPolicy),
    configured: config.configured === true,
    nextConnectSource: normalizeOAuthClientConfigNextConnectSource(config.nextConnectSource),
    oauthScopes: stringList(config.oauthScopes),
    tokenEndpointAuthMethod: normalizeOAuthTokenEndpointAuthMethod(config.tokenEndpointAuthMethod),
  }
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

export function connectionAppDisplayLabel(
  app: Pick<ConnectionAppSummary, "accountLabel" | "alias" | "displayName" | "providerAccountId">,
): string | undefined {
  return app.alias || app.displayName || app.accountLabel || app.providerAccountId
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
    valueType: field.valueType === "number" || field.valueType === "string" ? field.valueType : undefined,
  }
}

function defaultFederatedFieldValueType(key: string): ConnectionCredentialField["valueType"] {
  return key === "durationSeconds" || key === "lifetimeSeconds" ? "number" : undefined
}

function normalizeFederatedCredentialField(item: unknown): ConnectionCredentialField | undefined {
  const field = normalizeCredentialField(item)
  if (!field) {
    return undefined
  }
  return {
    ...field,
    valueType: field.valueType ?? defaultFederatedFieldValueType(field.key),
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

export function normalizeFederatedCredentialConfig(
  value: unknown,
): ConnectionProviderDetail["federatedCredentialConfig"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const config = value as RawFederatedCredentialConfig
  return {
    fields: Array.isArray(config.fields)
      ? config.fields
          .map((field) => normalizeFederatedCredentialField(field))
          .filter((field): field is ConnectionCredentialField => Boolean(field))
      : [],
  }
}

function normalizeAppCredentialField(item: unknown): ConnectionAppCredentialField | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined
  }

  const field = item as RawAppCredentialField
  const key = asString(field.key)
  const label = asString(field.label)
  const displayValue = asString(field.displayValue)
  if (!key || !label || displayValue === undefined) {
    return undefined
  }

  return {
    key,
    label,
    displayValue,
    secret: field.secret === true,
  }
}

function normalizeCredentialFieldSummary(value: unknown): ConnectionCredentialSummary["fields"][string] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const field = value as RawCredentialFieldSummary
  return {
    configured: field.configured === true,
    displayValue: asString(field.displayValue),
    maskedValue: asString(field.maskedValue),
  }
}

function normalizeCredentialSummary(value: unknown): ConnectionCredentialSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const summary = value as RawCredentialSummary
  if (summary.authType !== "api_key" && summary.authType !== "custom_credential") {
    return undefined
  }
  if (!summary.fields || typeof summary.fields !== "object" || Array.isArray(summary.fields)) {
    return undefined
  }

  const fields: ConnectionCredentialSummary["fields"] = {}
  for (const [key, field] of Object.entries(summary.fields)) {
    const normalized = normalizeCredentialFieldSummary(field)
    if (normalized) {
      fields[key] = normalized
    }
  }

  return {
    authType: summary.authType,
    fields,
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

export function isConnectionlessNoAuthProvider(
  provider: Pick<ConnectionProviderSummary, "appCount" | "authTypes" | "status">,
): boolean {
  return provider.authTypes.includes("no_auth") && provider.appCount === 0
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
    accountLabel: asString(item.accountLabel),
    authType: normalizeAuthType(item.authType),
    createdAt: asNumber(item.createdAt) ?? 0,
    displayName: asString(item.displayName),
    isDefault: item.isDefault === true,
    providerAccountId: asString(item.providerAccountId),
    status: normalizeAppStatus(item.status),
    updatedAt: asNumber(item.updatedAt) ?? 0,
  }
}

export function normalizeConnectionAppDetail(item: RawApp): ConnectionAppDetail | undefined {
  const app = normalizeApp(item)
  if (!app) {
    return undefined
  }

  return {
    ...app,
    comment: typeof item.comment === "string" ? item.comment : item.comment === null ? null : undefined,
    credentialFields: Array.isArray(item.credentialFields)
      ? item.credentialFields
          .map((field) => normalizeAppCredentialField(field))
          .filter((field): field is ConnectionAppCredentialField => Boolean(field))
      : undefined,
    credentialSummary: normalizeCredentialSummary(item.credentialSummary),
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
  const normalizedAuthTypes = normalizeAuthTypes(item.authTypes)
  const isPureNoAuthProvider = normalizedAuthTypes.length === 1 && normalizedAuthTypes[0] === "no_auth"
  const hasNoAuthReadyApp =
    apps.some((candidate) => isVirtualNoAuthApp(candidate) && candidate.status === "active") ||
    (isPureNoAuthProvider && apps.length === 0)
  const status: ConnectionProviderStatus = apps.some(
    (candidate) => candidate.status === "reauth_required" || candidate.status === "error",
  )
    ? "needs_attention"
    : manageableApps.some((candidate) => candidate.status === "active") || hasNoAuthReadyApp
      ? "connected"
      : "available"

  return {
    service,
    status,
    accountLabel: app ? connectionAppDisplayLabel(app) : undefined,
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
    oauthClientConfig: normalizeOAuthClientConfig(item.oauthClientConfig, service),
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

  const computedConnectedProviderCount = providers.filter(
    (provider) =>
      (provider.status === "connected" || provider.status === "needs_attention") &&
      !isConnectionlessNoAuthProvider(provider),
  ).length
  const connectionlessNoAuthProviderCount = providers.filter(
    (provider) => provider.status === "connected" && isConnectionlessNoAuthProvider(provider),
  ).length
  // 上游摘要把免配置 Provider 也计入 connected；UI 的“已连接”只表示用户实际建立过连接。
  const backendConnectedProviderCount = Math.max(
    0,
    (asNumber(appListSummary?.connectedProviderCount) ?? 0) - connectionlessNoAuthProviderCount,
  )

  return {
    ...createEmptyConnectionSummary("ready", undefined, workspace),
    activeConnections: visibleApps.filter((app) => app.status === "active").length,
    apps: visibleApps,
    connectedProviderCount: Math.max(backendConnectedProviderCount, computedConnectedProviderCount),
    connectableProviderCount: asNumber(appListSummary?.connectableProviderCount) ?? 0,
    needsAttention: visibleApps.filter((app) => app.status === "reauth_required" || app.status === "error").length,
    providerCount,
    providers,
    usage,
    updatedAt: new Date().toISOString(),
  }
}
