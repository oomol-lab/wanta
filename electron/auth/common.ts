import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type AuthStatus = "authenticated" | "unauthenticated"

/** 渲染层可见的账号信息（不含 apiKey——凭证永不进渲染进程）。 */
export interface AuthAccountSummary {
  id: string
  name: string
  avatarUrl?: string
}

export interface AuthState {
  status: AuthStatus
  /** status === "authenticated" 时为生效账号。 */
  account?: AuthAccountSummary
  updatedAt: string
}

export type AuthService = typeof AuthService
export const AuthService = serviceName("auth-service") as ServiceName<{
  ServerEvents: {
    authStateChanged: AuthState
  }
  ClientInvokes: {
    getAuthState(): Promise<AuthState>
    /** 已鉴权请求收到 401：清掉失效会话并广播未登录，但保留本地 profile 供后续登录覆盖。 */
    expireSession(): Promise<AuthState>
    /** 打开系统浏览器登录；resolve 于 deep-link 回调完成（或 10 分钟超时 reject）。 */
    login(): Promise<AuthState>
    /** 登出当前账号：删除凭证并停用 agent。 */
    logout(): Promise<AuthState>
  }
}>
