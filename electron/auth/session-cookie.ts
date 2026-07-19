import { app, session } from "electron"
import { apiBaseUrl, ooEndpoint } from "../domain.ts"

const oomolTokenCookieName = "oomol-token"
const apiHost = new URL(apiBaseUrl).hostname

function jwtExpirationDate(token: string): number | undefined {
  const [, payload] = token.split(".")
  if (!payload) {
    return undefined
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as { exp?: unknown }
    return typeof parsed.exp === "number" && Number.isFinite(parsed.exp) ? parsed.exp : undefined
  } catch {
    return undefined
  }
}

function fallbackExpirationDate(): number {
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
}

async function ensureElectronSessionReady(): Promise<void> {
  await app.whenReady()
}

/** Chat Desktop 同款凭证落点：Electron session cookie。HttpOnly，renderer JS 不可读。 */
export async function persistOomolSessionCookie(token: string): Promise<void> {
  await ensureElectronSessionReady()
  await session.defaultSession.cookies.set({
    url: apiBaseUrl,
    name: oomolTokenCookieName,
    value: token,
    domain: `.${ooEndpoint}`,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "no_restriction",
    expirationDate: jwtExpirationDate(token) ?? fallbackExpirationDate(),
  })
}

export async function readOomolSessionCookie(): Promise<string | undefined> {
  await ensureElectronSessionReady()
  const cookies = await session.defaultSession.cookies.get({ name: oomolTokenCookieName })
  const cookie = cookies.find((item) => {
    const domain = (item.domain || apiHost).replace(/^\./, "")
    return domain === ooEndpoint || domain.endsWith(`.${ooEndpoint}`)
  })
  return cookie?.value || undefined
}

function urlForCookie(cookie: { domain?: string; path?: string; secure?: boolean }): string {
  const scheme = cookie.secure === false ? "http" : "https"
  const host = (cookie.domain || apiHost).replace(/^\./, "")
  const rawPath = cookie.path || "/"
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`
  return `${scheme}://${host}${path}`
}

export async function clearOomolSessionCookies(): Promise<void> {
  await ensureElectronSessionReady()
  const cookies = await session.defaultSession.cookies.get({ name: oomolTokenCookieName })
  const matchingCookies = cookies.filter((item) => {
    const domain = (item.domain || apiHost).replace(/^\./, "")
    return domain === ooEndpoint || domain.endsWith(`.${ooEndpoint}`)
  })
  const firstAttempt = await Promise.allSettled(
    matchingCookies.map((item) => session.defaultSession.cookies.remove(urlForCookie(item), oomolTokenCookieName)),
  )
  const failedCookies = matchingCookies.filter((_, index) => firstAttempt[index]?.status === "rejected")
  if (failedCookies.length === 0) return
  // Electron cookie store 偶发瞬时失败时重试一次；仍失败则交给 AuthManager 的 invalidated 状态隔离旧 token。
  await Promise.all(
    failedCookies.map((item) => session.defaultSession.cookies.remove(urlForCookie(item), oomolTokenCookieName)),
  )
}
