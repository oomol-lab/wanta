// 渲染层向 *.<endpoint> 直接发已鉴权请求的统一底座。
//
// 凭证：唯一凭证是 httpOnly 的 oomol-token 会话 cookie（见 electron/auth/session-cookie.ts），
// 由 Chromium 网络栈在 credentials:"include" 时自动附带——渲染层既读不到也写不了它，token 全程不进
// 渲染进程（守 R4）。故这里**绝不**设置 Authorization / Cookie 头；只声明 credentials:"include"。
// 跨站 CORS 由主进程的 installOomolCorsShim 注入响应头放行（见 electron/net/oomol-cors.ts）。

const defaultTimeoutMs = 15_000

/** 会话过期/缺失的可恢复错误（HTTP 401）。文案含 "sign in"，供 resolveUserFacingError 归类为 auth_required。 */
export const authRequiredMessage = "Sign in is required."
export const oomolAuthRequiredEventName = "wanta:auth-required"

export interface OomolAuthRequiredEventDetail {
  /** 请求发起时间，用于忽略换号/重新登录前的过期 401。 */
  requestedAt: number
  status: 401
}

export class OomolHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "OomolHttpError"
    this.status = status
  }
}

export class OomolAuthRequiredError extends Error {
  constructor() {
    super(authRequiredMessage)
    this.name = "OomolAuthRequiredError"
  }
}

export interface OomolFetchOptions extends Omit<RequestInit, "credentials"> {
  /** 默认 15s，超时即 abort；调用方 signal 与超时同时生效。 */
  timeoutMs?: number
}

function assertNoRendererCredentialHeaders(headers: Headers): void {
  for (const name of ["authorization", "cookie"]) {
    if (headers.has(name)) {
      throw new Error(`oomolFetch must not set ${name} in the renderer; use the httpOnly session cookie.`)
    }
  }
}

function emitAuthRequired(response: Response, requestedAt: number): void {
  if (response.status !== 401 || typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return
  }
  window.dispatchEvent(
    new CustomEvent<OomolAuthRequiredEventDetail>(oomolAuthRequiredEventName, {
      detail: { requestedAt, status: 401 },
    }),
  )
}

/**
 * 底层 fetch：强制 credentials:"include"（带上会话 cookie）+ 默认 Accept: application/json + 超时。
 * 不做状态码判断，由各域客户端按自身语义处理响应。
 */
export function oomolFetch(input: string | URL, options: OomolFetchOptions = {}): Promise<Response> {
  const { timeoutMs = defaultTimeoutMs, headers, signal, ...init } = options
  const requestedAt = Date.now()
  // 用 Headers 规范化：调用方可能传 Headers 实例或 tuple 数组，对象展开会丢头（仅对纯对象有效）。
  const mergedHeaders = new Headers(headers)
  assertNoRendererCredentialHeaders(mergedHeaders)
  if (!mergedHeaders.has("Accept")) {
    mergedHeaders.set("Accept", "application/json")
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  return fetch(input, {
    ...init,
    credentials: "include",
    headers: mergedHeaders,
    signal: requestSignal,
  }).then((response) => {
    emitAuthRequired(response, requestedAt)
    return response
  })
}

/**
 * 常见 JSON 读取：401 归一为可恢复的 auth_required 哨兵，其余非 2xx 抛 OomolHttpError。
 * 204 / 空响应返回 undefined。
 */
export async function oomolFetchJson<T>(input: string | URL, options: OomolFetchOptions = {}): Promise<T> {
  const response = await oomolFetch(input, options)
  const text = await response.text()
  if (response.status === 401) {
    throw new OomolAuthRequiredError()
  }
  if (!response.ok) {
    throw new OomolHttpError(text || `Request failed with status ${response.status}`, response.status)
  }
  return (text ? (JSON.parse(text) as T) : undefined) as T
}

export function isAuthRequiredError(error: unknown): boolean {
  return error instanceof OomolAuthRequiredError || (error instanceof Error && error.message === authRequiredMessage)
}
