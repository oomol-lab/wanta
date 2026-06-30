import type { Session } from "electron"

import { session as electronSession } from "electron"
import { ooEndpoint } from "../domain.ts"

// 渲染进程要直接向 *.<endpoint> 发已鉴权请求（凭证是 httpOnly 的 oomol-token 会话 cookie，
// 由 Chromium 网络栈自动附带，渲染层永不读到 token —— 守 R4）。但渲染文档的 origin 是
// dev 的 http://localhost:5273 / 生产的 file://，跨站请求会被 Chromium 的 CORS 检查拦下：
// 服务端从不为这些 origin 下发 CORS 头，且带凭证时 ACAO 不能用 "*"，必须回显具体 origin。
// 故在主进程对 *.<endpoint> 的响应注入 CORS 头（回显请求自带的 Origin + 允许凭证），
// 严格限定 oomol 域名作用域，避免给任意 origin 放权。
//
// 这是渲染层迁移唯一需要的新主进程代码，纯头部改写、无 token 逻辑、无同步 fs（守 R1）。

const allowMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
// 渲染层各域用到的非简单请求头：连接器的 x-oo-organization-* / 条件请求头、语音的 x-api-request-id、
// JSON POST 的 content-type 等。预检若带 Access-Control-Request-Headers 则优先回显之。
const defaultAllowHeaders =
  "authorization,content-type,accept,if-none-match,if-modified-since,x-oo-organization-name,x-oo-organization-id,x-api-request-id"
const maxAgeSeconds = "600"

export interface OomolCorsOverrideInput {
  method: string
  /** 请求自带的 Origin 头（在 onBeforeSendHeaders 捕获）。缺失即非跨站 CORS 请求，不改写。 */
  origin: string | undefined
  /** 预检请求的 Access-Control-Request-Headers，若有则回显。 */
  requestedHeaders: string | undefined
  responseHeaders: Record<string, string[]>
}

export interface OomolCorsOverrideResult {
  responseHeaders: Record<string, string[]>
  /** 预检（OPTIONS）改写为 200，避免网关对意外 OPTIONS 返回非 2xx 致 Chromium 预检失败。 */
  statusLine?: string
}

function withoutCorsHeaders(headers: Record<string, string[]>): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase().startsWith("access-control-")) {
      continue
    }
    next[name] = value
  }
  return next
}

function mergedVary(headers: Record<string, string[]>): string[] {
  const existing = Object.entries(headers).find(([name]) => name.toLowerCase() === "vary")
  const tokens = new Set(
    (existing?.[1] ?? [])
      .flatMap((value) => value.split(","))
      .map((token) => token.trim())
      .filter(Boolean),
  )
  tokens.add("Origin")
  return [[...tokens].join(", ")]
}

/**
 * 仅放行本应用渲染进程的 origin：生产 file://（跨站 fetch 的 Origin 为 "null" 或 "file://"）、
 * dev 的 http(s)://localhost|127.0.0.1（任意端口）。即便 webRequest 已限定 *.<endpoint>，
 * 也不给其他 origin 回显带凭证的 CORS（防 webview / 被导航文档借本会话读已鉴权响应）。
 */
function isAllowedRendererOrigin(origin: string): boolean {
  if (origin === "null" || origin === "file://") {
    return true
  }
  try {
    const url = new URL(origin)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false
    }
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
  } catch {
    return false
  }
}

/**
 * 纯函数：给定一条来自 oomol 域名的响应，算出注入 CORS 头后的响应头（含预检的 200 改写）。
 * 主进程的 webRequest 监听只是这层纯逻辑的薄壳。
 */
export function applyOomolCors(input: OomolCorsOverrideInput): OomolCorsOverrideResult {
  const { method, origin, requestedHeaders } = input
  if (!origin || !isAllowedRendererOrigin(origin)) {
    return { responseHeaders: input.responseHeaders }
  }
  const vary = mergedVary(input.responseHeaders)
  const responseHeaders = withoutCorsHeaders(input.responseHeaders)
  responseHeaders["Access-Control-Allow-Origin"] = [origin]
  responseHeaders["Access-Control-Allow-Credentials"] = ["true"]
  responseHeaders["Vary"] = vary

  if (method.toUpperCase() === "OPTIONS") {
    responseHeaders["Access-Control-Allow-Methods"] = [allowMethods]
    responseHeaders["Access-Control-Allow-Headers"] = [requestedHeaders || defaultAllowHeaders]
    responseHeaders["Access-Control-Max-Age"] = [maxAgeSeconds]
    return { responseHeaders, statusLine: "HTTP/1.1 200 OK" }
  }

  return { responseHeaders }
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

/**
 * 在指定 session 上安装 CORS 注入，作用域严格限定 https://*.<endpoint>/*（域名由 ooEndpoint 派生，守 R2）。
 * onBeforeSendHeaders 捕获请求 Origin（按 details.id 暂存），onHeadersReceived 回显之并允许凭证；
 * 请求结束/出错时清理暂存，避免泄漏。
 */
export function installOomolCorsShim(targetSession: Session = electronSession.defaultSession): void {
  const filter = { urls: [`https://*.${ooEndpoint}/*`] }
  const originByRequestId = new Map<number, string>()
  const requestedHeadersByRequestId = new Map<number, string>()

  targetSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const origin = headerValue(details.requestHeaders, "origin")
    if (origin) {
      originByRequestId.set(details.id, origin)
    }
    const requested = headerValue(details.requestHeaders, "access-control-request-headers")
    if (requested) {
      requestedHeadersByRequestId.set(details.id, requested)
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  targetSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const origin = originByRequestId.get(details.id)
    originByRequestId.delete(details.id)
    const requestedHeaders = requestedHeadersByRequestId.get(details.id)
    requestedHeadersByRequestId.delete(details.id)

    const { responseHeaders, statusLine } = applyOomolCors({
      method: details.method,
      origin,
      requestedHeaders,
      responseHeaders: details.responseHeaders ?? {},
    })
    callback(statusLine ? { responseHeaders, statusLine } : { responseHeaders })
  })

  const drop = (details: { id: number }): void => {
    originByRequestId.delete(details.id)
    requestedHeadersByRequestId.delete(details.id)
  }
  targetSession.webRequest.onCompleted(filter, drop)
  targetSession.webRequest.onErrorOccurred(filter, drop)
}
