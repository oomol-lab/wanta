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

function retryDelay(backoffMs: number, attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** attempt))
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
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetcher(input, { ...init, signal })
      if (!isRetryableStatus(response.status) || attempt === attempts - 1) {
        return response
      }
      lastError = new Error(`Download request returned retryable HTTP ${response.status}.`)
      await response.body?.cancel()
    } catch (error) {
      if (init.signal?.aborted || attempt === attempts - 1) {
        throw error
      }
      lastError = error
    }
    await retryDelay(backoffMs, attempt)
  }

  throw lastError instanceof Error ? lastError : new Error("Download request failed.")
}
