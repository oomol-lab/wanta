import type { AuthService, AuthState } from "./common.ts"
import type { AuthAccount, AuthRuntimeAccount, AuthStore } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { app, dialog, shell } from "electron"
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
}

interface PendingLogin {
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
  private pending: PendingLogin | undefined
  private emitState: (state: AuthState) => Promise<void> = async () => {}
  private profileRefreshAccountId: string | undefined
  public readonly stateChanged = new ServiceEvent<AuthState>()

  public constructor(deps: AuthManagerDeps) {
    this.deps = deps
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
  public currentSessionToken(): Promise<string | undefined> {
    return readOomolSessionCookie()
  }

  /**
   * 运行时账号 = 持久化 profile + 会话 token。无 profile 或无 token（过期）时返回 null —— 即"未登录/会话失效"。
   * main 用它装配 agent / connector / org / skills，billing 也由它派生：token 在则全可用，token 失则全不可用（一致生命周期）。
   */
  public async activeRuntimeAccount(): Promise<AuthRuntimeAccount | null> {
    const account = this.activeAccount()
    if (!account) {
      return null
    }
    const sessionToken = await readOomolSessionCookie()
    if (!sessionToken) {
      return null
    }
    return { ...account, sessionToken }
  }

  public getAuthState(): Promise<AuthState> {
    void this.refreshActiveAccountProfile().catch((error: unknown) => {
      console.warn("[wanta] failed to refresh account profile:", error)
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

  /** 打开系统浏览器登录；promise 在 deep-link 回调完成后 resolve（agent 在后台启动）。 */
  public async login(): Promise<AuthState> {
    if (this.pending) {
      return this.pending.promise
    }

    const pending = this.createPending()
    this.pending = pending
    try {
      await shell.openExternal(browserLoginUrl(this.deps.protocolScheme))
    } catch (error) {
      this.rejectPending(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
    return pending.promise
  }

  public async logout(): Promise<AuthState> {
    const account = this.activeAccount()
    if (account) {
      this.deps.store.write(removeAccount(this.deps.store.read(), account))
      await this.deps.applyAccount(null)
    }
    await clearOomolSessionCookies().catch((error: unknown) => {
      console.warn("[wanta] failed to clear session cookies:", error)
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

    const pendingAtStart = this.pending
    try {
      const account = await exchangeLogin(authId)
      // 非本应用发起的回调（无 pending）：任何本地程序/网页都能构造 deep link 推送伪造 authID，
      // 必须经用户确认才落盘，防止静默换号（login CSRF）。
      if (!pendingAtStart && !(await confirmExternalLogin(account))) {
        return true
      }
      const state = await this.adoptAccount(account)
      if (this.pending === pendingAtStart) {
        this.resolvePending(state)
      }
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error))
      console.error("[wanta] browser sign-in failed:", wrapped)
      if (this.pending === pendingAtStart) {
        this.rejectPending(wrapped)
      }
    }
    return true
  }

  public dispose(): void {
    this.rejectPending(new Error("Sign-in was cancelled."))
  }

  /**
   * 鉴权状态。唯一凭证是会话 token：profile 仍在但 cookie 已过期/被驱逐时一律判为未登录
   * （一致生命周期 —— 渲染层据此落到登录页，聊天/连接器/用量随之全部不可用）。
   */
  private async currentState(): Promise<AuthState> {
    const account = this.activeAccount()
    const updatedAt = new Date().toISOString()
    if (!account) {
      return { status: "unauthenticated", updatedAt }
    }
    const sessionToken = await readOomolSessionCookie()
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
    await persistOomolSessionCookie(account.sessionToken)
    this.deps.store.write(upsertAccount(this.deps.store.read(), account))
    const state = await this.currentState()
    this.stateChanged.emit(state)
    await this.emitState(state)
    void this.deps.applyAccount(account).catch((error: unknown) => {
      console.error("[wanta] failed to start agent after sign-in:", error)
    })
    return state
  }

  /** 兼容旧 auth.json：若账号缺头像，用当前会话 token 后台补拉 profile 并只广播渲染层展示状态。 */
  private async refreshActiveAccountProfile(): Promise<void> {
    const account = this.activeAccount()
    if (!account || account.avatarUrl || this.profileRefreshAccountId === account.id) {
      return
    }
    const sessionToken = await readOomolSessionCookie()
    if (!sessionToken) {
      return
    }
    this.profileRefreshAccountId = account.id
    const profile = await requestLoginProfile(apiBaseUrl, sessionToken)
    const currentAccount = this.activeAccount()
    if (!currentAccount || currentAccount.id !== account.id) {
      return
    }
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
  }

  private createPending(): PendingLogin {
    let resolve!: (state: AuthState) => void
    let reject!: (error: Error) => void
    const promise = new Promise<AuthState>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    const timeout = setTimeout(() => {
      this.rejectPending(new Error("Sign-in timed out."))
    }, loginTimeoutMs)
    timeout.unref()
    return { promise, resolve, reject, timeout }
  }

  private resolvePending(state: AuthState): void {
    const pending = this.pending
    if (!pending) {
      return
    }
    clearTimeout(pending.timeout)
    this.pending = undefined
    pending.resolve(state)
  }

  private rejectPending(error: Error): void {
    const pending = this.pending
    if (!pending) {
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

/** 非应用发起的登录回调须经用户确认（dialog 需 app ready；回调可能先于 ready 到达）。 */
async function confirmExternalLogin(account: AuthRuntimeAccount): Promise<boolean> {
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
