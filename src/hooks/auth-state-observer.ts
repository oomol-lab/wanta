import type { AuthState } from "../../electron/auth/common.ts"

export interface AuthStateObserverOptions {
  load: () => Promise<AuthState>
  onError: (cause: unknown) => void
  onState: (state: AuthState) => void
  subscribe: (listener: (state: AuthState) => void) => () => void
}

/** 订阅权威事件并加载初始快照，确保迟到快照不能覆盖更新事件。 */
export function observeAuthState(options: AuthStateObserverOptions): () => void {
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
