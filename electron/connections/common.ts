import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ConnectionAuthType = "oauth2" | "api_key" | "custom_credential" | "federated" | "no_auth"
export type ConnectionProviderStatus = "available" | "connected" | "needs_attention"

export interface ConnectionProvider {
  service: string
  displayName: string
  iconUrl?: string
  categories: string[]
  authTypes: ConnectionAuthType[]
  status: ConnectionProviderStatus
  connected: boolean
  appStatus?: string
  accountLabel?: string
  updatedAt?: number
  canDisconnect: boolean
}

export interface ConnectionSummary {
  providers: ConnectionProvider[]
  connectedCount: number
  providerCount: number
  /** connector 是否可用（apiKey 已配置且请求成功）。 */
  ready: boolean
  message?: string
  updatedAt: number
}

export type ConnectionConnectInput =
  // appId 存在 → 走 by-id 重连端点（已连接账号的「重新连接」）；否则走 service 首次连接端点。
  | { authType: "oauth2"; service: string; appId?: string }
  | { authType: "no_auth"; service: string }
  | {
      authType: "api_key"
      service: string
      apiKey: string
      label?: string
      extra?: Record<string, string>
      appId?: string
    }
  | { authType: "custom_credential"; service: string; values: Record<string, string>; label?: string }
  | {
      authType: "federated"
      service: string
      subjectTokenSource: string
      target?: string
      config?: Record<string, string>
      label?: string
    }

export interface ConnectionActionResult {
  /** oauth2 → opened（已开浏览器，待轮询）；其余 connect → connected；disconnect → disconnected。 */
  status: "opened" | "connected" | "disconnected"
  summary: ConnectionSummary
}

/** provider 动态连接表单字段（来自 connector 的 apiKey/custom/federated 配置）。 */
export interface ConnectionField {
  key: string
  label: string
  required: boolean
  secret?: boolean
  placeholder?: string
  description?: string
}

export interface ConnectionApiKeyConfig {
  label?: string
  placeholder?: string
  description?: string
  extraFields: ConnectionField[]
}

export interface ConnectionCredentialConfig {
  fields: ConnectionField[]
}

/** provider 详情（GET /v1/providers/{service}），驱动详情页与动态连接表单。 */
export interface ConnectionProviderDetail {
  service: string
  displayName: string
  iconUrl?: string
  homepageUrl?: string
  categories: string[]
  authTypes: ConnectionAuthType[]
  apiKeyConfig?: ConnectionApiKeyConfig
  customCredentialConfig?: ConnectionCredentialConfig
  federatedCredentialConfig?: ConnectionCredentialConfig
}

/** 已连接账号（GET /v1/apps/services/{service}）。一个 provider 可有多账号。 */
export interface ConnectionAccount {
  id: string
  service: string
  accountLabel: string
  alias?: string
  status: string
  isDefault: boolean
  authType?: ConnectionAuthType | null
  scopes: string[]
  providerAccountId: string
  createdAt?: number
  updatedAt?: number
}

/** provider 接口/动作（GET /v1/actions?service=X）。 */
export interface ConnectionAction {
  id: string
  service: string
  name: string
  description?: string
  requiredScopes: string[]
}

/** 执行记录（GET /v1/apps/{service}/executions）。 */
export interface ConnectionExecution {
  executionId: string
  action: string
  actor?: string
  status: "success" | "error"
  errorCode?: string
  errorMessage?: string
  startedAt?: string
  finishedAt?: string
  outputSummary?: string
}

export interface ConnectionSummaryChangedEvent {
  summary: ConnectionSummary
}

export type ConnectionsService = typeof ConnectionsService
export const ConnectionsService = serviceName("connections-service") as ServiceName<{
  ServerEvents: {
    connectionSummaryChanged: ConnectionSummaryChangedEvent
  }
  ClientInvokes: {
    getSummary(): Promise<ConnectionSummary>
    connect(input: ConnectionConnectInput): Promise<ConnectionActionResult>
    disconnect(service: string): Promise<ConnectionActionResult>
    /** 按 appId 断开单个账号（多账号场景）。 */
    disconnectAccount(appId: string): Promise<ConnectionActionResult>
    /** provider 详情（含动态连接表单配置与官网链接）。 */
    getProviderDetail(service: string): Promise<ConnectionProviderDetail>
    /** 该 provider 下的已连接账号列表。 */
    listAccounts(service: string): Promise<ConnectionAccount[]>
    /** 该 provider 暴露的接口/动作列表。 */
    listActions(service: string): Promise<ConnectionAction[]>
    /** 该 provider 的近期执行记录。 */
    listExecutions(service: string): Promise<ConnectionExecution[]>
    /** 修改账号别名（alias 为空串则清除）。 */
    updateAlias(appId: string, alias: string): Promise<void>
    /** 设置该 provider 的默认账号。 */
    setDefaultAccount(service: string, appId: string): Promise<void>
    /** 在系统浏览器打开外部 URL（仅 https；用户已在 UI 显式确认）。 */
    openExternal(url: string): Promise<void>
    isReady(): Promise<boolean>
  }
}>
