export interface SharedRequest<T> {
  controller: AbortController
  consumers: number
  promise: Promise<T>
  settled: boolean
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
}

export function createSharedRequest<T>(load: (signal: AbortSignal) => Promise<T>): SharedRequest<T> {
  const controller = new AbortController()
  let settled = false
  const promise = load(controller.signal).finally(() => {
    settled = true
  })
  return {
    controller,
    consumers: 0,
    promise,
    get settled() {
      return settled
    },
  }
}

/** 调用方只取消自己的等待；最后一个消费者离开时才取消底层共享网络请求。 */
export function waitForSharedRequest<T>(request: SharedRequest<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  request.consumers += 1
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    request.consumers -= 1
    if (request.consumers === 0 && !request.settled && !request.controller.signal.aborted) {
      request.controller.abort(new DOMException("Shared request has no active consumers.", "AbortError"))
    }
  }
  if (!signal) return request.promise.finally(release)

  return new Promise<T>((resolve, reject) => {
    let finished = false
    const finish = (settle: () => void): void => {
      if (finished) return
      finished = true
      signal.removeEventListener("abort", onAbort)
      release()
      settle()
    }
    const onAbort = (): void => finish(() => reject(abortReason(signal)))
    signal.addEventListener("abort", onAbort, { once: true })
    void request.promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
