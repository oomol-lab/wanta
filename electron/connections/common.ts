export type ConnectionBackendStatus = "ready" | "signed-out" | "unavailable"
export type ConnectionAuthType = "oauth2" | "api_key" | "custom_credential" | "federated" | "no_auth" | null
export type ConnectionAppStatus = "active" | "reauth_required" | "error" | "disconnected"
export type ConnectionProviderStatus = "available" | "connected" | "needs_attention"
export type ConnectionWorkspace = { type: "personal" } | { organizationName: string; type: "organization" }
export type ConnectionProviderActionKind =
  | "oauth2"
  | "api_key"
  | "custom_credential"
  | "no_auth"
  | "federated"
  | "unavailable"

export interface ConnectionAppSummary {
  accountLabel?: string
  alias?: string
  authType: ConnectionAuthType
  createdAt: number
  displayName?: string
  id: string
  isDefault: boolean
  providerAccountId?: string
  service: string
  status: ConnectionAppStatus
  updatedAt: number
}

export interface ConnectionCredentialFieldSummary {
  configured: boolean
  displayValue?: string
  maskedValue?: string
}

export interface ConnectionCredentialSummary {
  authType: Extract<ConnectionAuthType, "api_key" | "custom_credential">
  fields: Record<string, ConnectionCredentialFieldSummary>
}

export interface ConnectionAppCredentialField {
  displayValue: string
  key: string
  label: string
  secret: boolean
}

export interface ConnectionAppDetail extends ConnectionAppSummary {
  comment?: string | null
  credentialFields?: ConnectionAppCredentialField[]
  credentialSummary?: ConnectionCredentialSummary
}

export interface ConnectionProviderSummary {
  accountLabel?: string
  appId?: string
  appStatus?: ConnectionAppStatus
  appAuthType?: ConnectionAuthType
  appCount: number
  apps: ConnectionAppSummary[]
  authTypes: Exclude<ConnectionAuthType, null>[]
  actionKind: ConnectionProviderActionKind
  canDisconnect: boolean
  categoryLabels: string[]
  connectedUpdatedAt?: number
  displayName: string
  iconUrl?: string
  oauthClientConfig?: ConnectionProviderOAuthClientConfigSummary | null
  service: string
  status: ConnectionProviderStatus
}

export type ConnectionProvider = ConnectionProviderSummary

export interface ConnectionUsageDailyPoint {
  calls: number
  date: string
  errors: number
  success: number
}

export interface ConnectionUsageServiceItem {
  calls: number
  errors: number
  recent: ConnectionUsageDailyPoint | null
  service: string
  success: number
  trend: ConnectionUsageDailyPoint[]
}

export interface ConnectionUsageSummary {
  calls: number
  days: number
  errors: number
  points: ConnectionUsageDailyPoint[]
  recent: ConnectionUsageDailyPoint | null
  services: ConnectionUsageServiceItem[]
  success: number
}

export type ConnectionExecutionLogStatus = "success" | "error"

export interface ConnectionExecutionLogItem {
  action: string
  durationMs: number | null
  errorCode?: string
  finishedAt: string
  id: string
  service: string
  startedAt: string
  status: ConnectionExecutionLogStatus
}

export interface ConnectionExecutionLogSummary {
  items: ConnectionExecutionLogItem[]
  nextCursor?: string
}

export interface ConnectionExecutionLogRequest {
  cursor?: string
  limit?: number
  service: string
  status?: ConnectionExecutionLogStatus
}

export interface ConnectionCredentialField {
  description?: string
  key: string
  label: string
  placeholder?: string
  required: boolean
  secret: boolean
  valueType?: "number" | "string"
}

export type ConnectionField = ConnectionCredentialField

export type ConnectionOAuthClientConfigPolicy = "default_only" | "user_required"
export type ConnectionOAuthClientConfigNextConnectSource = "custom" | "default" | "unconfigured"
export type ConnectionOAuthTokenEndpointAuthMethod = "client_secret_basic" | "client_secret_post" | "none"

export interface ConnectionOAuthClientConfigFieldDefinition {
  connectOnly?: boolean
  defaultValue?: string | string[]
  description?: string
  inputType: "password" | "string_array" | "text" | "textarea"
  key: string
  label: string
  location: "extra" | "secretExtra"
  placeholder?: string
  required: boolean
  secret: boolean
}

export interface ConnectionProviderOAuthClientConfigSummary {
  clientConfigFields: ConnectionOAuthClientConfigFieldDefinition[]
  clientConfigPolicy: ConnectionOAuthClientConfigPolicy
  configured: boolean
  nextConnectSource: ConnectionOAuthClientConfigNextConnectSource
  oauthScopes: string[]
  service: string
  tokenEndpointAuthMethod: ConnectionOAuthTokenEndpointAuthMethod
}

export interface ConnectionUserOAuthClientConfigSummary {
  clientConfigFields: ConnectionOAuthClientConfigFieldDefinition[]
  clientConfigPolicy: ConnectionOAuthClientConfigPolicy
  clientId: string | null
  configured: boolean
  expectedRedirectUri: string | null
  extra?: Record<string, unknown>
  hasSecretExtra?: Record<string, boolean>
  nextConnectSource: ConnectionOAuthClientConfigNextConnectSource
  service: string
  tokenEndpointAuthMethod: ConnectionOAuthTokenEndpointAuthMethod
}

export interface UpsertConnectionOAuthClientConfigPayload {
  clientId: string
  clientSecret?: string
  extra?: Record<string, unknown>
  secretExtra?: Record<string, string>
}

export interface ConnectionApiKeyConfig {
  description?: string
  extraFields: ConnectionCredentialField[]
  label?: string
  placeholder?: string
}

export interface ConnectionCustomCredentialConfig {
  fields: ConnectionCredentialField[]
}

export interface ConnectionFederatedCredentialConfig {
  fields: ConnectionCredentialField[]
}

export interface ConnectionFederatedConfig {
  [key: string]: number | string | undefined
  bucket?: string
  durationSeconds?: number
  oidcProviderArn?: string
  policy?: string
  roleArn?: string
  roleSessionName?: string
}

export type ConnectionCredentialConfig = ConnectionCustomCredentialConfig

export interface ConnectionProviderDetail extends ConnectionProviderSummary {
  apiKeyConfig: ConnectionApiKeyConfig | null
  customCredentialConfig: ConnectionCustomCredentialConfig | null
  federatedCredentialConfig: ConnectionFederatedCredentialConfig | null
  homepageUrl?: string
  oauthClientConfig: ConnectionProviderOAuthClientConfigSummary | null
}

export interface ConnectionSummary {
  status: ConnectionBackendStatus
  activeConnections: number
  apps: ConnectionAppSummary[]
  /** 用户实际配置或授权过的 Provider 种类数，不包含无需账号即可使用的免配置 Provider。 */
  connectedProviderCount: number
  connectableProviderCount: number
  needsAttention: number
  providerCount: number
  providers: ConnectionProviderSummary[]
  usage: ConnectionUsageSummary
  /** 目录已可用但后台用量聚合仍在读取时为 true，避免详情面板把空聚合误展示为“暂无调用”。 */
  usageLoading?: boolean
  message?: string
  updatedAt: string
  workspace: ConnectionWorkspace
}

export interface ConnectionSummaryRequest {
  forceRefresh?: boolean
}

export type ConnectionConnectInput =
  | {
      appId?: string
      authType: "oauth2"
      extra?: Record<string, unknown>
      secretExtra?: Record<string, string>
      service: string
    }
  | {
      apiKey: string
      appId?: string
      authType: "api_key"
      comment?: string
      extra?: Record<string, string>
      service: string
    }
  | {
      appId?: string
      authType: "custom_credential"
      comment?: string
      service: string
      values: Record<string, string>
    }
  | {
      appId?: string
      authType: "federated"
      comment?: string
      config: ConnectionFederatedConfig
      service: string
    }
  | { authType: "no_auth"; service: string }

export interface ConnectionActionResult {
  status: "opened" | "connected" | "disconnected"
  summary: ConnectionSummary
}

export interface ConnectionAction {
  id: string
  service: string
  name: string
  description?: string
  requiredScopes: string[]
}

export interface ConnectionAccount {
  id: string
  service: string
  accountLabel: string
  alias?: string
  status: string
  isDefault: boolean
  authType?: ConnectionAuthType
  scopes: string[]
  providerAccountId: string
  createdAt?: number
  updatedAt?: number
}

export type ConnectionExecution = ConnectionExecutionLogItem
