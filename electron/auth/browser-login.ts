// 浏览器登录流的纯函数部分（无网络/Electron 依赖，便于单测）。
// 流程与 oo-desktop 完全一致，仅 deep-link 协议不同（branding.protocolScheme）：
//   1. 系统浏览器打开 https://hub.<endpoint>/signin-app?protocol=<scheme>
//   2. 网页登录完成后跳回 <scheme>://signin?authID=<id>
//   3. POST api.<endpoint>/v1/auth/auth_id 用 authID 换 Set-Cookie 中的 oomol-token（会话 token，全应用唯一凭证）
//   4. 用该 token 取 /v1/users/profile（账号画像）。**不再换取长期 api-key**：网关层统一接受 cookie/token/api-key 鉴权。

import { hubBaseUrl } from "../domain.ts"

/** deep-link 回调的 host 段：<scheme>://signin?authID=...。 */
const signinAction = "signin"

interface UserProfileResponse {
  avatar?: unknown
  avatar_url?: unknown
  avatarUrl?: unknown
  displayname?: unknown
  email?: unknown
  image?: unknown
  nickname?: unknown
  photo?: unknown
  picture?: unknown
  uid?: unknown
  url?: unknown
  username?: unknown
}

/** 登录成功后的账号画像（仅取 lumo 需要的最小集）。 */
export interface BrowserLoginProfile {
  id: string
  name: string
  avatarUrl?: string
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeAvatarUrl(value: unknown): string | undefined {
  const raw = asString(value)
  if (!raw) {
    return undefined
  }
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** 浏览器登录入口 URL：hub 登录页经 ?protocol= 得知回跳的自定义协议。 */
export function hubSigninUrl(protocolScheme: string): string {
  const url = new URL(`${hubBaseUrl}/signin-app`)
  url.searchParams.set("protocol", protocolScheme)
  return url.toString()
}

/** 解析 deep-link 回调，返回 authID；非登录回调返回 undefined。 */
export function parseSigninCallback(url: string, protocolScheme: string): string | undefined {
  let callbackUrl: URL
  try {
    callbackUrl = new URL(url)
  } catch {
    return undefined
  }

  if (
    callbackUrl.protocol !== `${protocolScheme}:` ||
    callbackUrl.host !== signinAction ||
    (callbackUrl.pathname !== "" && callbackUrl.pathname !== "/")
  ) {
    return undefined
  }

  return asString(callbackUrl.searchParams.get("authID"))
}

/** 从 Set-Cookie 头集合中提取 oomol-token（会话 token，仅内存使用、不落盘）。 */
export function extractOomolTokenFromCookies(cookies: readonly string[]): string | undefined {
  for (const cookie of cookies) {
    for (const part of cookie.split(";")) {
      const trimmed = part.trim()
      if (trimmed.startsWith("oomol-token=")) {
        return trimmed.slice("oomol-token=".length)
      }
    }
  }
  return undefined
}

export function normalizeLoginProfile(response: UserProfileResponse): BrowserLoginProfile | undefined {
  const uid = asString(response.uid)
  const name =
    asString(response.nickname) ??
    asString(response.username) ??
    asString(response.displayname) ??
    asString(response.email) ??
    uid
  const avatarUrl =
    normalizeAvatarUrl(response.avatar_url) ??
    normalizeAvatarUrl(response.avatarUrl) ??
    normalizeAvatarUrl(response.avatar) ??
    normalizeAvatarUrl(response.picture) ??
    normalizeAvatarUrl(response.photo) ??
    normalizeAvatarUrl(response.image) ??
    normalizeAvatarUrl(response.url)

  if (!uid || !name) {
    return undefined
  }

  return { id: uid, name, ...(avatarUrl ? { avatarUrl } : {}) }
}
