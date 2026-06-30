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
}

export type ConnectionField = ConnectionCredentialField

export interface ConnectionApiKeyConfig {
  description?: string
  extraFields: ConnectionCredentialField[]
  label?: string
  placeholder?: string
}

export interface ConnectionCustomCredentialConfig {
  fields: ConnectionCredentialField[]
}

export interface ConnectionFederatedConfig {
  bucket?: string
  durationSeconds?: number
  oidcProviderArn: string
  policy?: string
  roleArn: string
  roleSessionName?: string
}

export type ConnectionCredentialConfig = ConnectionCustomCredentialConfig

export interface ConnectionProviderDetail extends ConnectionProviderSummary {
  apiKeyConfig: ConnectionApiKeyConfig | null
  customCredentialConfig: ConnectionCustomCredentialConfig | null
  federatedCredentialConfig: ConnectionFederatedConfig | null
  homepageUrl?: string
}

export interface ConnectionSummary {
  status: ConnectionBackendStatus
  activeConnections: number
  apps: ConnectionAppSummary[]
  connectedProviderCount: number
  connectableProviderCount: number
  needsAttention: number
  providerCount: number
  providers: ConnectionProviderSummary[]
  usage: ConnectionUsageSummary
  message?: string
  updatedAt: string
  workspace: ConnectionWorkspace
}

export interface ConnectionSummaryRequest {
  forceRefresh?: boolean
}

export type ConnectionConnectInput =
  | { authType: "oauth2"; service: string; appId?: string }
  | {
      apiKey: string
      appId?: string
      authType: "api_key"
      extra?: Record<string, string>
      label?: string
      service: string
    }
  | {
      appId?: string
      authType: "custom_credential"
      label?: string
      service: string
      values: Record<string, string>
    }
  | {
      appId?: string
      authType: "federated"
      config: ConnectionFederatedConfig
      label?: string
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
