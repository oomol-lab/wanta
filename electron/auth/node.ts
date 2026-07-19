import type { AuthService, AuthState } from "./common.ts"
import type { AuthAccount, AuthRuntimeAccount, AuthStore } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { app, dialog, shell } from "electron"
import { randomUUID } from "node:crypto"
import { logDiagnostic } from "../diagnostics-log.ts"
import { apiBaseUrl } from "../domain.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  browserLoginUrl,
  extractOomolTokenFromCookies,
  normalizeLoginProfile,
  parseSigninCallback,
} from "./browser-login.ts"
import { AuthService as AuthServiceName } from "./common.ts"
import { clearOomolSessionCookies, persistOomolSessionCookie, readOomolSessionCookie } from "./session-cookie.ts"
import { removeAccount, selectAccount, upsertAccount } from "./store.ts"

export interface AuthManagerDeps {
  store: AuthStore
  /** deep-link 协议（生产 wanta / dev wanta-local，见 branding）。 */
  protocolScheme: string
  /** 凭证变化（登录 / 登出）后由 main 重新装配 agent + connector。 */
  applyAccount: (account: AuthRuntimeAccount | null) => Promise<void>
  runtime?: Partial<AuthManagerRuntime>
}

export interface AuthManagerRuntime {
  clearCookies: () => Promise<void>
  confirmLogin: (account: AuthRuntimeAccount) => Promise<boolean>
  exchangeLogin: (authId: string) => Promise<AuthRuntimeAccount>
  openExternal: (url: string) => Promise<void>
  persistCookie: (token: string) => Promise<void>
  readCookie: () => Promise<string | undefined>
}

interface PendingLogin {
  id: string
  promise: Promise<AuthState>
  resolve: (state: AuthState) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const loginTimeoutMs = 10 * 60_000

/**
 * 浏览器登录的全部逻辑与凭证持有者。**不注册为 RPC service**：
 * @oomol/connection 的 invoke 按方法名动态派发、无白名单，注册实例上的任何公开方法
 * （如返回会话 token 的 currentSessionToken / activeRuntimeAccount）都会暴露给渲染进程。
 * 凭证只能留在这里，渲染层经 AuthServiceImpl（薄门面，仅 getAuthState/login/logout）访问。
 */
export class AuthManager {
  private readonly deps: AuthManagerDeps
  private readonly runtime: AuthManagerRuntime
  private pending: PendingLogin | undefined
  private callbackQueue: Promise<void> = Promise.resolve()
  private authEpoch = 0
  private sessionInvalidated = false
  private emitState: (state: AuthState) => Promise<void> = async () => {}
  private profileRefreshCompletedAccountId: string | undefined
  private profileRefreshInFlightAccountId: string | undefined
  public readonly stateChanged = new ServiceEvent<AuthState>()

  public constructor(deps: AuthManagerDeps) {
    this.deps = deps
    this.runtime = {
      clearCookies: clearOomolSessionCookies,
      confirmLogin: confirmBrowserLogin,
      exchangeLogin,
      openExternal: (url) => shell.openExternal(url),
      persistCookie: persistOomolSessionCookie,
      readCookie: readOomolSessionCookie,
      ...deps.runtime,
    }
  }

  /** 由 AuthServiceImpl 在构造时绑定，把状态变化广播给渲染层。 */
  public bindStateEmitter(emit: (state: AuthState) => Promise<void>): void {
    this.emitState = emit
  }

  /** 生效账号的持久化 profile（不含任何凭证）。 */
  public activeAccount(): AuthAccount | null {
    return selectAccount(this.deps.store.read())
  }

  /** 当前会话 token（全应用唯一凭证，来自 Electron 会话 cookie）；未登录或已过期/被驱逐时为 undefined。 */
  public async currentSessionToken(): Promise<string | undefined> {
    if (this.sessionInvalidated) return undefined
    return this.runtime.readCookie()
  }

  /**
   * 运行时账号 = 持久化 profile + 会话 token。无 profile 或无 token（过期）时返回 null —— 即"未登录/会话失效"。
   * main 用它装配 agent / connector / team / skills，billing 也由它派生：token 在则全可用，token 失则全不可用（一致生命周期）。
   */
  public async activeRuntimeAccount(): Promise<AuthRuntimeAccount | null> {
    if (this.sessionInvalidated) {
      return null
    }
    const account = this.activeAccount()
    if (!account) {
      return null
    }
    const sessionToken = await this.runtime.readCookie()
    if (!sessionToken) {
      return null
    }
    return { ...account, sessionToken }
  }

  public getAuthState(): Promise<AuthState> {
    void this.refreshActiveAccountProfile().catch((error: unknown) => {
      console.warn("[wanta] failed to refresh account profile:", error)
      logDiagnostic("auth", "failed to refresh account profile", { error }, "warn")
    })
    return this.currentState()
  }

  /**
   * 重新计算并广播当前鉴权状态。供 main 在"会话中途过期"装配登出态时调用：渲染层的 useAuth 只在挂载或
   * 收到 authStateChanged 时更新，不轮询；故 token 失效后必须主动推一次"未登录"，渲染层才会落回登录页
   * （否则 AppShell 会停在"Agent 启动中"）。
   */
  public async broadcastAuthState(): Promise<void> {
    const state = await this.currentState()
    this.stateChanged.emit(state)
    await this.emitState(state)
  }

  /** 会话 token 被服务端判定失效：清 cookie、停 agent、广播未登录；不删除本地 profile。 */
  public async expireSession(): Promise<AuthState> {
    this.authEpoch += 1
    this.sessionInvalidated = true
    this.rejectPending(new Error("Sign-in was cancelled."))
    await this.runtime.clearCookies().catch((error: unknown) => {
      console.warn("[wanta] failed to clear expired session cookies:", error)
      logDiagnostic("auth", "failed to clear expired session cookies", { error }, "warn")
    })
    await this.deps.applyAccount(null)
    const state = await this.currentState()
    this.stateChanged.emit(state)
    await this.emitState(state)
    return state
  }

  /** 打开系统浏览器登录；promise 在 deep-link 回调完成后 resolve（agent 在后台启动）。 */
  public async login(): Promise<AuthState> {
    if (this.pending) {
      return this.pending.promise
    }

    const pending = this.createPending()
    this.authEpoch += 1
    this.pending = pending
    try {
      await this.runtime.openExternal(browserLoginUrl(this.deps.protocolScheme))
    } catch (error) {
      this.rejectPending(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
    return pending.promise
  }

  public async logout(): Promise<AuthState> {
    this.authEpoch += 1
    this.sessionInvalidated = true
    this.rejectPending(new Error("Sign-in was cancelled."))
    const account = this.activeAccount()
    if (account) {
      this.deps.store.write(removeAccount(this.deps.store.read(), account))
      await this.deps.applyAccount(null)
    }
    await this.runtime.clearCookies().catch((error: unknown) => {
      console.warn("[wanta] failed to clear session cookies:", error)
      logDiagnostic("auth", "failed to clear session cookies", { error }, "warn")
    })
    const state = await this.currentState()
    this.stateChanged.emit(state)
    await this.emitState(state)
    return state
  }

  /** deep-link 入口：是登录回调则完成登录并返回 true，否则返回 false 交由其他处理。 */
  public async completeBrowserLoginCallback(url: string): Promise<boolean> {
    const authId = parseSigninCallback(url, this.deps.protocolScheme)
    if (!authId) {
      return false
    }

    const request = { authId, epoch: this.authEpoch, pendingId: this.pending?.id }
    const operation = this.callbackQueue.catch(() => undefined).then(() => this.handleBrowserLoginCallback(request))
    this.callbackQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async handleBrowserLoginCallback(request: {
    authId: string
    epoch: number
    pendingId?: string
  }): Promise<boolean> {
    try {
      const account = await this.runtime.exchangeLogin(request.authId)
      if (request.epoch !== this.authEpoch || (request.pendingId && this.pending?.id !== request.pendingId)) {
        return true
      }
      // launcher 当前没有返回可校验的 state/nonce，因此即使存在 pending 也必须确认账号身份，
      // 避免登录窗口内由另一个 deep link 静默换号。
      if (!(await this.runtime.confirmLogin(account))) {
        if (request.pendingId && this.pending?.id === request.pendingId) {
          this.rejectPending(new Error("Sign-in was cancelled."), request.pendingId)
        }
        return true
      }
      if (request.epoch !== this.authEpoch || (request.pendingId && this.pending?.id !== request.pendingId)) return true
      const state = await this.adoptAccount(account)
      if (request.pendingId && this.pending?.id === request.pendingId) {
        this.resolvePending(state, request.pendingId)
      }
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error))
      console.error("[wanta] browser sign-in failed:", wrapped)
      logDiagnostic("auth", "browser sign-in failed", { error: wrapped }, "error")
      if (request.pendingId && this.pending?.id === request.pendingId) {
        this.rejectPending(wrapped, request.pendingId)
      }
    }
    return true
  }

  public dispose(): void {
    this.authEpoch += 1
    this.rejectPending(new Error("Sign-in was cancelled."))
  }

  /**
   * 鉴权状态。唯一凭证是会话 token：profile 仍在但 cookie 已过期/被驱逐时一律判为未登录
   * （一致生命周期 —— 渲染层据此落到登录页，聊天/连接器/用量随之全部不可用）。
   */
  private async currentState(): Promise<AuthState> {
    const account = this.activeAccount()
    const updatedAt = new Date().toISOString()
    if (!account || this.sessionInvalidated) {
      return { status: "unauthenticated", updatedAt }
    }
    const sessionToken = await this.runtime.readCookie()
    if (!sessionToken) {
      return { status: "unauthenticated", updatedAt }
    }
    return {
      status: "authenticated",
      account: { id: account.id, name: account.name, ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}) },
      updatedAt,
    }
  }

  /** 落盘 profile + 持久化会话 cookie + 广播 + 后台装配 agent（启动较慢，渲染层用既有 isReady 轮询显示"Agent 启动中"）。 */
  private async adoptAccount(account: AuthRuntimeAccount): Promise<AuthState> {
    const previousAuth = this.deps.store.read()
    const previousToken = await this.runtime.readCookie()
    this.deps.store.write(upsertAccount(previousAuth, account))
    try {
      await this.runtime.persistCookie(account.sessionToken)
    } catch (error) {
      try {
        this.deps.store.write(previousAuth)
        if (previousToken) await this.runtime.persistCookie(previousToken)
        else await this.runtime.clearCookies()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to persist and roll back the signed-in account")
      }
      throw error
    }
    this.sessionInvalidated = false
    const state = await this.currentState()
    this.stateChanged.emit(state)
    await this.emitState(state)
    void this.deps.applyAccount(account).catch((error: unknown) => {
      console.error("[wanta] failed to start agent after sign-in:", error)
      logDiagnostic("auth", "failed to start agent after sign-in", { error }, "error")
    })
    return state
  }

  /** 兼容旧 auth.json：若账号缺头像，用当前会话 token 后台补拉 profile 并只广播渲染层展示状态。 */
  private async refreshActiveAccountProfile(): Promise<void> {
    if (this.sessionInvalidated) return
    const account = this.activeAccount()
    if (
      !account ||
      account.avatarUrl ||
      this.profileRefreshCompletedAccountId === account.id ||
      this.profileRefreshInFlightAccountId === account.id
    ) {
      return
    }
    this.profileRefreshInFlightAccountId = account.id
    try {
      const sessionToken = await this.runtime.readCookie()
      if (!sessionToken) {
        return
      }
      const profile = await requestLoginProfile(apiBaseUrl, sessionToken)
      const currentAccount = this.activeAccount()
      if (!currentAccount || currentAccount.id !== account.id) {
        return
      }
      this.profileRefreshCompletedAccountId = account.id
      if (!profile.avatarUrl && profile.name === currentAccount.name) {
        return
      }
      this.deps.store.write(
        upsertAccount(this.deps.store.read(), {
          ...currentAccount,
          name: profile.name,
          ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          sessionToken,
        }),
      )
      await this.emitState(await this.currentState())
    } finally {
      if (this.profileRefreshInFlightAccountId === account.id) {
        this.profileRefreshInFlightAccountId = undefined
      }
    }
  }

  private createPending(): PendingLogin {
    const id = randomUUID()
    let resolve!: (state: AuthState) => void
    let reject!: (error: Error) => void
    const promise = new Promise<AuthState>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    const timeout = setTimeout(() => {
      this.rejectPending(new Error("Sign-in timed out."), id)
    }, loginTimeoutMs)
    timeout.unref()
    return { id, promise, resolve, reject, timeout }
  }

  private resolvePending(state: AuthState, expectedId?: string): void {
    const pending = this.pending
    if (!pending || (expectedId && pending.id !== expectedId)) {
      return
    }
    clearTimeout(pending.timeout)
    this.pending = undefined
    pending.resolve(state)
  }

  private rejectPending(error: Error, expectedId?: string): void {
    const pending = this.pending
    if (!pending || (expectedId && pending.id !== expectedId)) {
      return
    }
    clearTimeout(pending.timeout)
    this.pending = undefined
    pending.reject(error)
  }
}

/** 渲染层可见的薄门面：仅暴露契约声明的三个方法，凭证与回调处理留在 AuthManager。 */
export class AuthServiceImpl extends ConnectionService<AuthService> implements IConnectionService<AuthService> {
  private readonly manager: AuthManager

  public constructor(manager: AuthManager) {
    super(AuthServiceName)
    this.manager = manager
    manager.bindStateEmitter(async (state) => {
      await this.send("authStateChanged", state)
    })
  }

  public getAuthState(): Promise<AuthState> {
    return this.manager.getAuthState()
  }

  public expireSession(): Promise<AuthState> {
    return this.manager.expireSession()
  }

  public login(): Promise<AuthState> {
    return this.manager.login()
  }

  public logout(): Promise<AuthState> {
    return this.manager.logout()
  }

  public override dispose(): void {
    this.manager.dispose()
    super.dispose()
  }
}

/** launcher 尚无 state/nonce 回传，所有登录回调均须确认账号（dialog 需 app ready）。 */
async function confirmBrowserLogin(account: AuthRuntimeAccount): Promise<boolean> {
  await app.whenReady()
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: `使用账号 "${account.name}" 登录？`,
    detail: "收到来自浏览器的登录请求。如果这不是你发起的登录，请取消。",
    buttons: ["登录", "取消"],
    defaultId: 0,
    cancelId: 1,
  })
  return response === 0
}

/** authID → 会话 token → profile。纯网络交换，无副作用。会话 token 即全应用唯一凭证，不再换取长期 api-key。 */
async function exchangeLogin(authId: string): Promise<AuthRuntimeAccount> {
  const api = apiBaseUrl
  const token = await requestSigninWithAuthId(api, authId)
  const profile = await requestLoginProfile(api, token)
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    sessionToken: token,
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = withGetSetCookie.getSetCookie?.()
  if (setCookies && setCookies.length > 0) {
    return setCookies
  }
  const single = headers.get("set-cookie")
  return single ? [single] : []
}

function authRequestSignal(): AbortSignal {
  return AbortSignal.timeout(15_000)
}

/** authID → 会话 token（来自 Set-Cookie 的 oomol-token，仅内存使用、不落盘）。 */
async function requestSigninWithAuthId(api: string, authId: string): Promise<string> {
  const response = await fetch(`${api}/v1/auth/auth_id`, {
    method: "POST",
    signal: authRequestSignal(),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authID: authId }),
  })
  if (!response.ok) {
    throw new Error(`Failed to complete OOMOL sign-in: ${response.status}`)
  }
  const token = extractOomolTokenFromCookies(getSetCookieHeaders(response.headers))
  if (!token) {
    throw new Error("OOMOL sign-in did not return a session token.")
  }
  return token
}

async function requestLoginProfile(
  api: string,
  token: string,
): Promise<{ id: string; name: string; avatarUrl?: string }> {
  const response = await fetch(`${api}/v1/users/profile`, {
    method: "GET",
    signal: authRequestSignal(),
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to get OOMOL profile: ${response.status}`)
  }
  const profile = normalizeLoginProfile((await response.json()) as Parameters<typeof normalizeLoginProfile>[0])
  if (!profile) {
    throw new Error("OOMOL profile response is invalid.")
  }
  return profile
}
