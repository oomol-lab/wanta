import type {
  LinkRuntimeSelection,
  LinkRuntimeService,
  LinkRuntimeState,
  OpenConnectorAppSummary,
  OpenConnectorRuntimeStatus,
  OpenConnectorTestResult,
} from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { ServiceEvent } from "../service-events.ts"
import { LinkRuntimeService as LinkRuntimeServiceName } from "./common.ts"

export interface RuntimeCredentialEncryption {
  decryptString(encrypted: Buffer): string
  encryptString(plainText: string): Buffer
  getSelectedStorageBackend?(): string
  isEncryptionAvailable(): boolean
}

interface PersistedOpenConnector {
  baseUrl: string
  consoleUrl: string
  encryptedRuntimeToken?: string
}

interface PersistedLinkRuntime {
  version: 1
  selected: LinkRuntimeSelection
  openConnector?: PersistedOpenConnector
}

interface StoredRuntimeCredential {
  version: 1
  origin: string
  token: string
}

interface LinkRuntimeManagerOptions {
  dir: string
  encryption: RuntimeCredentialEncryption
  getOomolAvailable: () => Promise<boolean>
  fetch?: typeof fetch
  healthStatusTtlMs?: number
  healthTimeoutMs?: number
  now?: () => number
  onRuntimeChanged?: () => Promise<void> | void
  platform?: NodeJS.Platform
  writeText?: typeof atomicWriteText
}

interface ReadableCredential {
  available: boolean
  token?: string
}

const defaultHealthStatusTtlMs = 10_000
const defaultHealthTimeoutMs = 5_000
const maxHealthRedirects = 3
const inventoryCacheMs = 5_000

export class LinkRuntimeManager {
  private readonly file: string
  private readonly encryption: RuntimeCredentialEncryption
  private readonly fetch: typeof fetch
  private readonly getOomolAvailable: () => Promise<boolean>
  private readonly healthStatusTtlMs: number
  private readonly healthTimeoutMs: number
  private readonly now: () => number
  private readonly onRuntimeChanged?: () => Promise<void> | void
  private readonly platform: NodeJS.Platform
  private readonly writeText: typeof atomicWriteText
  private mutationChain: Promise<void> = Promise.resolve()
  private statusCache: { expiresAt: number; status: OpenConnectorRuntimeStatus } | undefined
  private statusInFlight: Promise<OpenConnectorRuntimeStatus> | undefined
  private statusRevision = 0
  private inventoryCache: { expiresAt: number; apps: OpenConnectorAppSummary[] } | undefined
  private inventoryInFlight: Promise<OpenConnectorAppSummary[]> | undefined
  private inventoryRevision = 0
  public readonly stateChanged = new ServiceEvent<LinkRuntimeState>()

  public constructor(options: LinkRuntimeManagerOptions) {
    this.file = path.join(options.dir, "link-runtime.json")
    this.encryption = options.encryption
    this.fetch = options.fetch ?? globalThis.fetch
    this.getOomolAvailable = options.getOomolAvailable
    this.healthStatusTtlMs = options.healthStatusTtlMs ?? defaultHealthStatusTtlMs
    this.healthTimeoutMs = options.healthTimeoutMs ?? defaultHealthTimeoutMs
    this.now = options.now ?? Date.now
    this.onRuntimeChanged = options.onRuntimeChanged
    this.platform = options.platform ?? process.platform
    this.writeText = options.writeText ?? atomicWriteText
  }

  public async getState(): Promise<LinkRuntimeState> {
    return this.stateFrom(await this.read())
  }

  public async getOpenConnectorStatus(): Promise<OpenConnectorRuntimeStatus> {
    const persisted = await this.read()
    const config = persisted.openConnector
    if (!config) return { kind: "unknown" }

    const credential = this.readCredential(config)
    if (!credential.available) return { kind: "unknown" }

    const now = this.now()
    if (this.statusCache && this.statusCache.expiresAt > now) {
      return this.statusCache.status
    }
    if (this.statusInFlight) return this.statusInFlight

    const revision = this.statusRevision
    const request = this.checkHealth(config.baseUrl, credential.token).then((result) => {
      const checkedAt = this.now()
      const status = statusForTestResult(result, checkedAt)
      if (revision === this.statusRevision) {
        this.statusCache = { expiresAt: checkedAt + this.healthStatusTtlMs, status }
      }
      return status
    })
    this.statusInFlight = request
    const finishStatus = () => {
      if (this.statusInFlight === request) this.statusInFlight = undefined
    }
    void request.then(finishStatus, finishStatus)
    return request
  }

  public async listOpenConnectorApps(signal?: AbortSignal): Promise<OpenConnectorAppSummary[]> {
    const persisted = await this.read()
    const config = persisted.openConnector
    if (persisted.selected !== "openconnector" || !config) return []
    const credential = this.readCredential(config)
    if (!credential.available) throw new Error("The saved OpenConnector credential is unavailable.")

    const now = this.now()
    if (this.inventoryCache && this.inventoryCache.expiresAt > now) return this.inventoryCache.apps
    if (this.inventoryInFlight) return this.inventoryInFlight

    const revision = this.inventoryRevision
    const request = this.loadOpenConnectorApps(config.baseUrl, credential.token, signal).then((apps) => {
      if (revision === this.inventoryRevision) {
        this.inventoryCache = { apps, expiresAt: this.now() + inventoryCacheMs }
      }
      return apps
    })
    this.inventoryInFlight = request
    const finishInventory = () => {
      if (this.inventoryInFlight === request) this.inventoryInFlight = undefined
    }
    void request.then(finishInventory, finishInventory)
    return request
  }

  public async saveOpenConnector(input: {
    baseUrl: string
    consoleUrl?: string
    runtimeToken?: string
  }): Promise<LinkRuntimeState> {
    const baseUrl = normalizeOriginUrl(input.baseUrl, "OpenConnector API URL")
    const consoleUrl = normalizeOriginUrl(input.consoleUrl ?? baseUrl, "OpenConnector Console URL")
    const runtimeToken = normalizeNewToken(input.runtimeToken)

    return this.mutate(async () => {
      const persisted = await this.read()
      const existing = persisted.openConnector
      if (existing?.encryptedRuntimeToken && existing.baseUrl !== baseUrl && runtimeToken === undefined) {
        throw new Error("Enter a new runtime token or clear the saved token before changing the API origin.")
      }

      const encryptedRuntimeToken =
        runtimeToken === undefined
          ? existing?.encryptedRuntimeToken
          : this.encryptCredential({ origin: baseUrl, token: runtimeToken, version: 1 })
      await this.write({
        ...persisted,
        openConnector: {
          baseUrl,
          consoleUrl,
          ...(encryptedRuntimeToken ? { encryptedRuntimeToken } : {}),
        },
      })
      return this.configurationChanged()
    })
  }

  public async testOpenConnector(input: { baseUrl: string; runtimeToken?: string }): Promise<OpenConnectorTestResult> {
    const baseUrl = normalizeOriginUrl(input.baseUrl, "OpenConnector API URL")
    const runtimeToken = normalizeNewToken(input.runtimeToken)
    let token = runtimeToken

    if (token === undefined) {
      const saved = (await this.read()).openConnector
      if (saved?.baseUrl === baseUrl) {
        token = this.readCredential(saved).token
      }
    }

    this.invalidateOpenConnectorStatus()
    return this.checkHealth(baseUrl, token)
  }

  public selectRuntime(kind: LinkRuntimeSelection): Promise<LinkRuntimeState> {
    if (kind !== "oomol" && kind !== "openconnector") {
      return Promise.reject(new Error("Unsupported Link runtime selection."))
    }
    return this.mutate(async () => {
      const persisted = await this.read()
      if (persisted.selected === kind) return this.stateFrom(persisted)
      await this.write({ ...persisted, selected: kind })
      return this.configurationChanged()
    })
  }

  public clearOpenConnectorToken(): Promise<LinkRuntimeState> {
    return this.mutate(async () => {
      const persisted = await this.read()
      const existing = persisted.openConnector
      if (!existing?.encryptedRuntimeToken) return this.stateFrom(persisted)
      const { encryptedRuntimeToken: _removed, ...openConnector } = existing
      await this.write({ ...persisted, openConnector })
      return this.configurationChanged()
    })
  }

  public removeOpenConnector(): Promise<LinkRuntimeState> {
    return this.mutate(async () => {
      const persisted = await this.read()
      if (!persisted.openConnector) return this.stateFrom(persisted)
      const { openConnector: _removed, ...remaining } = persisted
      await this.write(remaining)
      return this.configurationChanged()
    })
  }

  public async openConnectorRuntime(): Promise<{
    baseUrl: string
    consoleUrl: string
    kind: "openconnector"
    runtimeToken?: string
  } | null> {
    const persisted = await this.read()
    if (persisted.selected !== "openconnector" || !persisted.openConnector) return null
    const credential = this.readCredential(persisted.openConnector)
    if (!credential.available) return null
    return {
      baseUrl: persisted.openConnector.baseUrl,
      consoleUrl: persisted.openConnector.consoleUrl,
      kind: "openconnector",
      ...(credential.token ? { runtimeToken: credential.token } : {}),
    }
  }

  public async selectedRuntime(): Promise<LinkRuntimeSelection> {
    return (await this.read()).selected
  }

  public async oomolAvailabilityChanged(): Promise<void> {
    this.invalidateOpenConnectorStatus()
    this.stateChanged.emit(await this.getState())
  }

  private mutate(operation: () => Promise<LinkRuntimeState>): Promise<LinkRuntimeState> {
    const result = this.mutationChain.then(operation, operation)
    this.mutationChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async configurationChanged(): Promise<LinkRuntimeState> {
    this.invalidateOpenConnectorStatus()
    const state = await this.getState()
    this.stateChanged.emit(state)
    void Promise.resolve(this.onRuntimeChanged?.()).catch((error: unknown) => {
      console.warn("[wanta] failed to apply Link runtime change:", error)
    })
    return state
  }

  private invalidateOpenConnectorStatus(): void {
    this.statusRevision += 1
    this.statusCache = undefined
    this.statusInFlight = undefined
    this.inventoryRevision += 1
    this.inventoryCache = undefined
    this.inventoryInFlight = undefined
  }

  private async stateFrom(persisted: PersistedLinkRuntime): Promise<LinkRuntimeState> {
    const oomol = await this.getOomolAvailable()
    const openconnector = Boolean(persisted.openConnector && this.readCredential(persisted.openConnector).available)
    const availability = { oomol, openconnector }
    return {
      selected: persisted.selected,
      active: availability[persisted.selected] ? persisted.selected : "none",
      availability,
      ...(persisted.openConnector
        ? {
            openConnector: {
              baseUrl: persisted.openConnector.baseUrl,
              consoleUrl: persisted.openConnector.consoleUrl,
              tokenConfigured: Boolean(persisted.openConnector.encryptedRuntimeToken),
            },
          }
        : {}),
    }
  }

  private readCredential(config: PersistedOpenConnector): ReadableCredential {
    if (!config.encryptedRuntimeToken) return { available: true }
    try {
      this.assertSecureStorageAvailable()
      const plainText = this.encryption.decryptString(Buffer.from(config.encryptedRuntimeToken, "base64"))
      const credential = parseCredential(plainText)
      if (credential.origin !== config.baseUrl) return { available: false }
      return { available: true, token: credential.token }
    } catch {
      return { available: false }
    }
  }

  private encryptCredential(credential: StoredRuntimeCredential): string {
    this.assertSecureStorageAvailable()
    return this.encryption.encryptString(JSON.stringify(credential)).toString("base64")
  }

  private assertSecureStorageAvailable(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error(
        "Secure runtime credential storage is unavailable. Unlock the operating system keychain and try again.",
      )
    }
    if (this.platform === "linux") {
      const backend = this.encryption.getSelectedStorageBackend?.() ?? "unknown"
      if (backend === "basic_text" || backend === "unknown") {
        throw new Error(
          "Secure runtime credential storage requires GNOME Keyring or KWallet on Linux; plaintext fallback is disabled.",
        )
      }
    }
  }

  private async checkHealth(baseUrl: string, token: string | undefined): Promise<OpenConnectorTestResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.healthTimeoutMs)
    try {
      const response = await this.requestOpenConnector(baseUrl, "/v1/health", token, controller.signal)
      if (!response) return { kind: "incompatible", reason: "not-openconnector" }
      if (response.status === 401) return { kind: "unauthorized" }
      if (!response.ok) return { kind: "incompatible", reason: "not-openconnector" }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { kind: "incompatible", reason: "unsupported-response" }
      }
      if (!isRecord(body) || !isRecord(body.data)) {
        return { kind: "incompatible", reason: "unsupported-response" }
      }
      if (body.data.ok !== true || body.data.runtime !== "oomol-connect") {
        return { kind: "incompatible", reason: "not-openconnector" }
      }
      return { kind: "online" }
    } catch (error) {
      if (controller.signal.aborted) return { kind: "offline", reason: "timeout" }
      return { kind: "offline", reason: isTlsError(error) ? "tls" : "unreachable" }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async loadOpenConnectorApps(
    baseUrl: string,
    token: string | undefined,
    signal?: AbortSignal,
  ): Promise<OpenConnectorAppSummary[]> {
    const timeoutSignal = AbortSignal.timeout(this.healthTimeoutMs)
    const response = await this.requestOpenConnector(
      baseUrl,
      "/v1/apps",
      token,
      signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    )
    if (!response) throw new Error("OpenConnector inventory redirected to a different origin.")
    if (response.status === 401) throw new Error("OpenConnector inventory authorization failed.")
    if (!response.ok) throw new Error(`OpenConnector inventory request failed with HTTP ${response.status}.`)
    const body: unknown = await response.json()
    if (!isRecord(body) || body.success !== true || !Array.isArray(body.data)) {
      throw new Error("OpenConnector inventory returned an incompatible response.")
    }
    return body.data.map(normalizeOpenConnectorApp)
  }

  private async requestOpenConnector(
    baseUrl: string,
    pathname: string,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<Response | null> {
    let url = new URL(pathname, baseUrl)
    for (let redirects = 0; redirects <= maxHealthRedirects; redirects += 1) {
      const response = await this.fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        redirect: "manual",
        signal,
      })
      if (!isRedirect(response.status)) return response
      const location = response.headers.get("location")
      if (!location || redirects === maxHealthRedirects) return null
      const redirected = new URL(location, url)
      if (redirected.origin !== url.origin) return null
      url = redirected
    }
    return null
  }

  private async read(): Promise<PersistedLinkRuntime> {
    try {
      return parsePersisted(JSON.parse(await readFile(this.file, "utf8")))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { selected: "oomol", version: 1 }
      }
      throw error
    }
  }

  private async write(persisted: PersistedLinkRuntime): Promise<void> {
    await this.writeText(this.file, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 })
  }
}

export class LinkRuntimeServiceImpl
  extends ConnectionService<LinkRuntimeService>
  implements IConnectionService<LinkRuntimeService>
{
  private readonly manager: LinkRuntimeManager
  private readonly unsubscribe: () => void

  public constructor(manager: LinkRuntimeManager) {
    super(LinkRuntimeServiceName)
    this.manager = manager
    this.unsubscribe = manager.stateChanged.on((state) => {
      void this.send("linkRuntimeChanged", state).catch((error: unknown) => {
        console.warn("[wanta] Link runtime broadcast failed:", error)
      })
    })
  }

  public getState(): Promise<LinkRuntimeState> {
    return this.manager.getState()
  }

  public getOpenConnectorStatus(): Promise<OpenConnectorRuntimeStatus> {
    return this.manager.getOpenConnectorStatus()
  }

  public listOpenConnectorApps(): Promise<OpenConnectorAppSummary[]> {
    return this.manager.listOpenConnectorApps()
  }

  public saveOpenConnector(input: {
    baseUrl: string
    consoleUrl?: string
    runtimeToken?: string
  }): Promise<LinkRuntimeState> {
    return this.manager.saveOpenConnector(input)
  }

  public testOpenConnector(input: { baseUrl: string; runtimeToken?: string }): Promise<OpenConnectorTestResult> {
    return this.manager.testOpenConnector(input)
  }

  public selectRuntime(kind: LinkRuntimeSelection): Promise<LinkRuntimeState> {
    return this.manager.selectRuntime(kind)
  }

  public clearOpenConnectorToken(): Promise<LinkRuntimeState> {
    return this.manager.clearOpenConnectorToken()
  }

  public removeOpenConnector(): Promise<LinkRuntimeState> {
    return this.manager.removeOpenConnector()
  }

  public override dispose(): void {
    this.unsubscribe()
    super.dispose()
  }
}

function normalizeOriginUrl(input: string, label: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin === "null") {
    throw new Error(`${label} must use HTTP or HTTPS.`)
  }
  if (url.username || url.password) throw new Error(`${label} must not include credentials.`)
  if (url.pathname !== "/") throw new Error(`${label} must contain only an origin, without an API or Console path.`)
  return url.origin
}

function normalizeNewToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  const normalized = token.trim()
  if (!normalized) throw new Error("Runtime token must not be empty. Use the clear-token action instead.")
  return normalized
}

function parsePersisted(value: unknown): PersistedLinkRuntime {
  if (!isRecord(value) || value.version !== 1 || (value.selected !== "oomol" && value.selected !== "openconnector")) {
    throw new Error("Link runtime configuration has an unsupported format.")
  }
  if (value.openConnector === undefined) return { selected: value.selected, version: 1 }
  if (!isRecord(value.openConnector)) throw new Error("Link runtime configuration has an unsupported format.")
  const { baseUrl, consoleUrl, encryptedRuntimeToken } = value.openConnector
  if (typeof baseUrl !== "string" || typeof consoleUrl !== "string") {
    throw new Error("Link runtime configuration has an unsupported format.")
  }
  if (encryptedRuntimeToken !== undefined && typeof encryptedRuntimeToken !== "string") {
    throw new Error("Link runtime configuration has an unsupported format.")
  }
  const openConnector = {
    baseUrl: normalizeOriginUrl(baseUrl, "Saved OpenConnector API URL"),
    consoleUrl: normalizeOriginUrl(consoleUrl, "Saved OpenConnector Console URL"),
    ...(encryptedRuntimeToken ? { encryptedRuntimeToken } : {}),
  }
  return { openConnector, selected: value.selected, version: 1 }
}

function parseCredential(plainText: string): StoredRuntimeCredential {
  const value: unknown = JSON.parse(plainText)
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.origin !== "string" ||
    typeof value.token !== "string" ||
    !value.token
  ) {
    throw new Error("Runtime credential has an unsupported format.")
  }
  return { origin: normalizeOriginUrl(value.origin, "Runtime credential origin"), token: value.token, version: 1 }
}

function statusForTestResult(result: OpenConnectorTestResult, checkedAt: number): OpenConnectorRuntimeStatus {
  switch (result.kind) {
    case "online":
      return { checkedAt, kind: "online" }
    case "offline":
      return { checkedAt, kind: "offline" }
    case "unauthorized":
      return { checkedAt, kind: "unauthorized" }
    case "incompatible":
      return { checkedAt, kind: "incompatible" }
  }
}

function normalizeOpenConnectorApp(value: unknown): OpenConnectorAppSummary {
  if (
    !isRecord(value) ||
    typeof value.service !== "string" ||
    typeof value.alias !== "string" ||
    typeof value.authType !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.isDefault !== "boolean" ||
    (value.status !== "active" && value.status !== "disconnected")
  ) {
    throw new Error("OpenConnector inventory returned an incompatible app entry.")
  }
  return {
    authType: value.authType,
    connectionName: value.alias,
    displayName: value.displayName,
    isDefault: value.isDefault,
    service: value.service,
    status: value.status,
    ...(typeof value.accountLabel === "string" && value.accountLabel ? { accountLabel: value.accountLabel } : {}),
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isTlsError(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  const code = isRecord(cause) && typeof cause.code === "string" ? cause.code : ""
  return code.includes("CERT") || code.includes("SSL") || code.includes("TLS")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
