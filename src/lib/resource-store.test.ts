import { describe, expect, it } from "vitest"
import { createResource } from "./resource-store.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, reject, resolve }
}

describe("ResourceStore", () => {
  it("reuses a normal in-flight refresh", () => {
    const pending = deferred<string>()
    let calls = 0
    const resource = createResource<string>({
      load: () => {
        calls += 1
        return pending.promise
      },
    })

    const first = resource.refresh()
    const second = resource.refresh()

    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  it("lets force refresh bypass an older in-flight request", async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    let calls = 0
    const resource = createResource<string>({
      load: () => {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      },
    })

    const staleRequest = resource.refresh()
    const freshRequest = resource.refresh({ forceRefresh: true })

    expect(calls).toBe(2)

    first.resolve("stale")
    await staleRequest
    expect(resource.getSnapshot().data).toBe(null)

    second.resolve("fresh")
    await freshRequest
    expect(resource.getSnapshot().data).toBe("fresh")
  })
})
