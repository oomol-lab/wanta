import type {
  ConnectionAccount,
  ConnectionAction,
  ConnectionActionResult,
  ConnectionAuthType,
  ConnectionConnectInput,
  ConnectionExecution,
  ConnectionProviderDetail,
  ConnectionsService,
  ConnectionSummary,
} from "./common.ts"
import type { RawApp, RawProvider } from "./summary.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { connectorBaseUrl, consoleBaseUrl } from "../domain.ts"
import { ConnectionsService as ConnectionsServiceName } from "./common.ts"
import { emptyConnectionSummary, mergeConnectionSummary } from "./summary.ts"

export interface ConnectionsServiceOptions {
  apiKey?: string
}

export class ConnectionsServiceImpl
  extends ConnectionService<ConnectionsService>
  implements IConnectionService<ConnectionsService>
{
  private apiKey?: string
  /** 凭证代数：apiKey 每变一次递增，用于丢弃换代前发起的迟到摘要广播。 */
  private credentialEpoch = 0

  public constructor(options?: ConnectionsServiceOptions) {
    super(ConnectionsServiceName)
    this.apiKey = options?.apiKey
  }

  /** 登录 / 登出时由 main 更新凭证（账号的默认 api-key，等价旧 OO_API_KEY）。 */
  public setApiKey(apiKey: string | undefined): void {
    this.apiKey = apiKey
    this.credentialEpoch++
  }

  public isReady(): Promise<boolean> {
    return Promise.resolve(Boolean(this.apiKey))
  }

  public async getSummary(): Promise<ConnectionSummary> {
    if (!this.apiKey) {
      return emptyConnectionSummary(Date.now(), "未登录")
    }
    const [apps, providers] = await Promise.all([
      this.connectorRequest<RawApp[]>("/v1/apps", { method: "GET" }),
      this.connectorRequest<RawProvider[]>("/v1/providers", { method: "GET" }),
    ])
    return mergeConnectionSummary(apps ?? [], providers ?? [], Date.now())
  }

  public async connect(input: ConnectionConnectInput): Promise<ConnectionActionResult> {
    this.assertReady()
    const service = encodeURIComponent(input.service)

    if (input.authType === "oauth2") {
      // appId 存在 → 已连接账号的「重新连接」走 by-id 端点；否则首次连接走 service 端点。
      const path = input.appId
        ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect`
        : `/v1/apps/${service}/connect`
      const data = await this.connectorRequest<{ authorizationUrl?: string }>(path, {
        method: "POST",
        body: JSON.stringify({ returnUri: `${consoleBaseUrl}/app-connections/callback` }),
      })
      if (!data?.authorizationUrl) {
        throw new Error("Connector connect did not return an authorization URL")
      }
      await this.openExternal(data.authorizationUrl)
      const summary = await this.refreshAndEmit()
      return { status: "opened", summary }
    }

    if (input.authType === "no_auth") {
      await this.connectorRequest(`/v1/apps/${service}/connect/no-auth`, { method: "POST" })
    } else if (input.authType === "api_key") {
      const path = input.appId
        ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/api-key`
        : `/v1/apps/${service}/connect/api-key`
      await this.connectorRequest(path, {
        method: "POST",
        body: JSON.stringify({ apiKey: input.apiKey, label: input.label, extra: input.extra }),
      })
    } else if (input.authType === "federated") {
      await this.connectorRequest(`/v1/apps/${service}/connect/federated`, {
        method: "POST",
        body: JSON.stringify({
          subjectTokenSource: input.subjectTokenSource,
          target: input.target,
          config: input.config,
          label: input.label,
        }),
      })
    } else {
      await this.connectorRequest(`/v1/apps/${service}/connect/custom-credential`, {
        method: "POST",
        body: JSON.stringify({ values: input.values, label: input.label }),
      })
    }

    const summary = await this.refreshAndEmit()
    return { status: "connected", summary }
  }

  public async disconnect(service: string): Promise<ConnectionActionResult> {
    this.assertReady()
    await this.connectorRequest(`/v1/apps/${encodeURIComponent(service)}`, { method: "DELETE" })
    const summary = await this.refreshAndEmit()
    return { status: "disconnected", summary }
  }

  public async disconnectAccount(appId: string): Promise<ConnectionActionResult> {
    this.assertReady()
    await this.connectorRequest(`/v1/apps/by-id/${encodeURIComponent(appId)}`, { method: "DELETE" })
    const summary = await this.refreshAndEmit()
    return { status: "disconnected", summary }
  }

  public async getProviderDetail(service: string): Promise<ConnectionProviderDetail> {
    this.assertReady()
    const raw = await this.connectorRequest<RawProviderDetail>(`/v1/providers/${encodeURIComponent(service)}`, {
      method: "GET",
    })
    return {
      service: raw.service,
      displayName: raw.displayName ?? raw.service,
      iconUrl: raw.iconUrl,
      homepageUrl: raw.homepageUrl,
      categories: (raw.categories ?? []).map((c) => c.displayName ?? c.id ?? "").filter(Boolean),
      authTypes: raw.authTypes ?? [],
      apiKeyConfig: raw.apiKeyConfig
        ? {
            label: raw.apiKeyConfig.label,
            placeholder: raw.apiKeyConfig.placeholder,
            description: raw.apiKeyConfig.description,
            extraFields: raw.apiKeyConfig.extraFields ?? [],
          }
        : undefined,
      customCredentialConfig: raw.customCredentialConfig
        ? { fields: raw.customCredentialConfig.fields ?? [] }
        : undefined,
      federatedCredentialConfig: raw.federatedCredentialConfig
        ? { fields: raw.federatedCredentialConfig.fields ?? [] }
        : undefined,
    }
  }

  public async listAccounts(service: string): Promise<ConnectionAccount[]> {
    this.assertReady()
    const raw =
      (await this.connectorRequest<RawAccount[]>(`/v1/apps/services/${encodeURIComponent(service)}`, {
        method: "GET",
      })) ?? []
    return raw.map((a) => ({
      id: a.id,
      service: a.service,
      accountLabel: a.accountLabel ?? a.displayName ?? a.providerAccountId ?? a.id,
      alias: a.alias ?? undefined,
      status: a.status ?? "unknown",
      isDefault: Boolean(a.isDefault),
      authType: a.authType ?? undefined,
      scopes: a.scopes ?? [],
      providerAccountId: a.providerAccountId ?? "",
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))
  }

  public async listActions(service: string): Promise<ConnectionAction[]> {
    this.assertReady()
    const raw =
      (await this.connectorRequest<RawAction[]>(`/v1/actions?service=${encodeURIComponent(service)}`, {
        method: "GET",
      })) ?? []
    // service 缺省时该端点返回 [{ service }] 索引；带 service 时返回完整动作，过滤掉无 name 的索引项。
    return raw
      .filter((a) => typeof a.name === "string")
      .map((a) => ({
        id: a.id ?? `${a.service}.${a.name}`,
        service: a.service,
        name: a.name as string,
        description: a.description,
        requiredScopes: a.requiredScopes ?? [],
      }))
  }

  public async listExecutions(service: string): Promise<ConnectionExecution[]> {
    this.assertReady()
    const data = await this.connectorRequest<{ data?: RawExecution[] } | RawExecution[]>(
      `/v1/apps/${encodeURIComponent(service)}/executions?limit=20`,
      { method: "GET" },
    )
    const rows = Array.isArray(data) ? data : (data?.data ?? [])
    return rows.map((e) => ({
      executionId: e.executionId,
      action: e.action,
      actor: e.actor,
      status: e.status === "error" ? "error" : "success",
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      outputSummary: e.outputSummary,
    }))
  }

  public async updateAlias(appId: string, alias: string): Promise<void> {
    this.assertReady()
    await this.connectorRequest(`/v1/apps/by-id/${encodeURIComponent(appId)}`, {
      method: "PATCH",
      body: JSON.stringify({ alias: alias.trim() === "" ? null : alias.trim() }),
    })
    await this.refreshAndEmit()
  }

  public async setDefaultAccount(service: string, appId: string): Promise<void> {
    this.assertReady()
    await this.connectorRequest(`/v1/apps/services/${encodeURIComponent(service)}/default`, {
      method: "PUT",
      body: JSON.stringify({ appId }),
    })
    await this.refreshAndEmit()
  }

  public async openExternal(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") {
      throw new Error(`Refusing to open non-https URL: ${parsed.protocol}`)
    }
    await shell.openExternal(parsed.toString())
  }

  private assertReady(): void {
    if (!this.apiKey) {
      throw new Error("Connections not available (sign in first)")
    }
  }

  /** 重新拉取摘要并广播（凭证 / endpoint 变化后由 main 调用，面板即时刷新）。 */
  public async refreshAndEmit(): Promise<ConnectionSummary> {
    const epoch = this.credentialEpoch
    const summary = await this.getSummary()
    // 拉取期间凭证已换代：结果照常返回给调用方，但不广播（防旧账号摘要乱序覆盖新状态）。
    if (epoch === this.credentialEpoch) {
      await this.send("connectionSummaryChanged", { summary })
    }
    return summary
  }

  private async connectorRequest<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${connectorBaseUrl}${path}`, {
      ...init,
      // Lumo 用网关 api-key → Authorization: Bearer，不带 x-oomol-user-uuid（与 oo-desktop 不同）。
      headers: { Authorization: `Bearer ${this.apiKey ?? ""}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await response.text()
    let payload: unknown
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
    }
    if (!response.ok) {
      throw new Error(`Connector ${path} failed: ${extractEnvelopeMessage(payload) ?? `HTTP ${response.status}`}`)
    }
    return unwrapEnvelope(payload) as T
  }
}

function unwrapEnvelope(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}

function extractEnvelopeMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const p = payload as { message?: unknown; errorMessage?: unknown }
    if (typeof p.errorMessage === "string") {
      return p.errorMessage
    }
    if (typeof p.message === "string") {
      return p.message
    }
  }
  return undefined
}

/** connector 原始返回形状（仅取本端用到的字段）。 */
interface RawField {
  key: string
  label: string
  required: boolean
  secret?: boolean
  placeholder?: string
  description?: string
}

interface RawProviderDetail {
  service: string
  displayName?: string
  iconUrl?: string
  homepageUrl?: string
  categories?: Array<{ id?: string; displayName?: string }>
  authTypes?: ConnectionAuthType[]
  apiKeyConfig?: {
    label?: string
    placeholder?: string
    description?: string
    extraFields?: RawField[]
  } | null
  customCredentialConfig?: { fields?: RawField[] } | null
  federatedCredentialConfig?: { fields?: RawField[] } | null
}

interface RawAccount {
  id: string
  service: string
  accountLabel?: string
  displayName?: string
  alias?: string | null
  status?: string
  isDefault?: boolean
  authType?: ConnectionAuthType | null
  scopes?: string[]
  providerAccountId?: string
  createdAt?: number
  updatedAt?: number
}

interface RawAction {
  id?: string
  service: string
  name?: string
  description?: string
  requiredScopes?: string[]
}

interface RawExecution {
  executionId: string
  action: string
  actor?: string
  status?: string
  errorCode?: string
  errorMessage?: string
  startedAt?: string
  finishedAt?: string
  outputSummary?: string
}
