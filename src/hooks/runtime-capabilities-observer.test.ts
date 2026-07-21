import type { RuntimeCapabilities } from "../../electron/runtime/common.ts"

import { describe, expect, it, vi } from "vitest"
import { resolveRuntimeCapabilities } from "../../electron/runtime/common.ts"
import { observeRuntimeCapabilities } from "./runtime-capabilities-observer.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, reject, resolve }
}

const localCapabilities = resolveRuntimeCapabilities({
  mode: "local",
  localAgentAvailable: false,
  linkRuntimeAvailable: false,
})
const oomolCapabilities = resolveRuntimeCapabilities({
  mode: "oomol",
  localAgentAvailable: true,
  linkRuntimeAvailable: true,
})

describe("observeRuntimeCapabilities", () => {
  it("does not let the initial snapshot overwrite a newer runtime event", async () => {
    const initial = deferred<RuntimeCapabilities>()
    const states: RuntimeCapabilities[] = []
    let emit: ((state: RuntimeCapabilities) => void) | undefined
    const dispose = observeRuntimeCapabilities({
      load: () => initial.promise,
      onError: vi.fn(),
      onState: (state) => states.push(state),
      subscribe: (listener) => {
        emit = listener
        return vi.fn()
      },
    })

    emit?.(oomolCapabilities)
    initial.resolve(localCapabilities)
    await initial.promise

    expect(states).toEqual([oomolCapabilities])
    dispose()
  })

  it("ignores a stale initial error after a successful runtime event", async () => {
    const initial = deferred<RuntimeCapabilities>()
    const onError = vi.fn()
    let emit: ((state: RuntimeCapabilities) => void) | undefined
    const dispose = observeRuntimeCapabilities({
      load: () => initial.promise,
      onError,
      onState: vi.fn(),
      subscribe: (listener) => {
        emit = listener
        return vi.fn()
      },
    })

    emit?.(oomolCapabilities)
    initial.reject(new Error("stale"))
    await expect(initial.promise).rejects.toThrow("stale")

    expect(onError).not.toHaveBeenCalled()
    dispose()
  })

  it("stops applying results and unsubscribes after disposal", async () => {
    const initial = deferred<RuntimeCapabilities>()
    const onState = vi.fn()
    const unsubscribe = vi.fn()
    const dispose = observeRuntimeCapabilities({
      load: () => initial.promise,
      onError: vi.fn(),
      onState,
      subscribe: () => unsubscribe,
    })

    dispose()
    initial.resolve(localCapabilities)
    await initial.promise

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(onState).not.toHaveBeenCalled()
  })
})
