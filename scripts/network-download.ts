// 安装期下载统一使用有界超时和有限重试，避免黑洞网络永久挂住，同时不重试确定性的 4xx。

export interface FetchWithRetryOptions {
  attempts?: number
  backoffMs?: number
  fetcher?: typeof fetch
  timeoutMs?: number
}

const defaultAttempts = 3
const defaultBackoffMs = 250
const defaultTimeoutMs = 30_000

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function retryDelay(backoffMs: number, attempt: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", abort)
        resolve()
      },
      backoffMs * 2 ** attempt,
    )
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}

export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? defaultAttempts))
  const backoffMs = Math.max(0, Math.trunc(options.backoffMs ?? defaultBackoffMs))
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? defaultTimeoutMs))
  const fetcher = options.fetcher ?? fetch
  const inputSignal = input instanceof Request ? input.signal : undefined
  const callerSignals = [inputSignal, init.signal].filter((signal): signal is AbortSignal => Boolean(signal))
  const callerSignal = callerSignals.length > 1 ? AbortSignal.any(callerSignals) : callerSignals[0]
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetcher(input, { ...init, signal })
      if (!isRetryableStatus(response.status) || attempt === attempts - 1) {
        return response
      }
      lastError = new Error(`Download request returned retryable HTTP ${response.status}.`)
      await response.body?.cancel()
    } catch (error) {
      if (callerSignal?.aborted || attempt === attempts - 1) {
        throw error
      }
      lastError = error
    }
    // 单次请求的 timeout 只约束本次 fetch；一旦超时，该 signal 已经 aborted，不能再拿它
    // 控制下一次尝试前的退避，否则 retryDelay 会立即拒绝，让“最多 3 次”退化成只请求 1 次。
    await retryDelay(backoffMs, attempt, callerSignal)
  }

  throw lastError instanceof Error ? lastError : new Error("Download request failed.")
}
