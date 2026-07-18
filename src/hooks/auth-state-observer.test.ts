import type { AuthState } from "../../electron/auth/common.ts"

import { describe, expect, it, vi } from "vitest"
import { observeAuthState } from "./auth-state-observer.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, reject, resolve }
}

function authState(id: string): AuthState {
  return {
    account: { id, name: id },
    status: "authenticated",
    updatedAt: `2026-07-18T00:00:0${id}.000Z`,
  }
}

describe("observeAuthState", () => {
  it("treats a synchronously replayed event as newer than the initial snapshot", async () => {
    const states: AuthState[] = []
    const dispose = observeAuthState({
      load: async () => authState("1"),
      onError: vi.fn(),
      onState: (state) => states.push(state),
      subscribe: (listener) => {
        listener(authState("2"))
        return vi.fn()
      },
    })

    await Promise.resolve()

    expect(states.map((state) => state.account?.id)).toEqual(["2"])
    dispose()
  })

  it("does not let the initial snapshot overwrite a newer auth event", async () => {
    const initial = deferred<AuthState>()
    const states: AuthState[] = []
    let emit: ((state: AuthState) => void) | undefined
    const dispose = observeAuthState({
      load: () => initial.promise,
      onError: vi.fn(),
      onState: (state) => states.push(state),
      subscribe: (listener) => {
        emit = listener
        return vi.fn()
      },
    })

    emit?.(authState("2"))
    initial.resolve(authState("1"))
    await initial.promise

    expect(states.map((state) => state.account?.id)).toEqual(["2"])
    dispose()
  })

  it("ignores a stale initial error after a successful auth event", async () => {
    const initial = deferred<AuthState>()
    const onError = vi.fn()
    let emit: ((state: AuthState) => void) | undefined
    const dispose = observeAuthState({
      load: () => initial.promise,
      onError,
      onState: vi.fn(),
      subscribe: (listener) => {
        emit = listener
        return vi.fn()
      },
    })

    emit?.(authState("2"))
    initial.reject(new Error("stale"))
    await expect(initial.promise).rejects.toThrow("stale")

    expect(onError).not.toHaveBeenCalled()
    dispose()
  })

  it("stops applying results and unsubscribes after disposal", async () => {
    const initial = deferred<AuthState>()
    const onState = vi.fn()
    const unsubscribe = vi.fn()
    const dispose = observeAuthState({
      load: () => initial.promise,
      onError: vi.fn(),
      onState,
      subscribe: () => unsubscribe,
    })

    dispose()
    initial.resolve(authState("1"))
    await initial.promise

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(onState).not.toHaveBeenCalled()
  })
})
