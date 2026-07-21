import type { RuntimeCapabilities } from "../../electron/runtime/common.ts"

export interface RuntimeCapabilitiesObserverOptions {
  load: () => Promise<RuntimeCapabilities>
  onError: (cause: unknown) => void
  onState: (state: RuntimeCapabilities) => void
  subscribe: (listener: (state: RuntimeCapabilities) => void) => () => void
}

/** 先订阅权威事件再加载初始快照，避免迟到快照覆盖 runtime 切换事件。 */
export function observeRuntimeCapabilities(options: RuntimeCapabilitiesObserverOptions): () => void {
  let active = true
  let updateVersion = 0
  const requestVersion = updateVersion

  const unsubscribe = options.subscribe((state) => {
    if (!active) {
      return
    }
    updateVersion += 1
    options.onState(state)
  })
  void options.load().then(
    (state) => {
      if (active && updateVersion === requestVersion) {
        options.onState(state)
      }
    },
    (cause: unknown) => {
      if (active && updateVersion === requestVersion) {
        options.onError(cause)
      }
    },
  )

  return () => {
    active = false
    updateVersion += 1
    unsubscribe()
  }
}
