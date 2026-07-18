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

  it("does not let an older refresh overwrite authoritative pushed data", async () => {
    const pending = deferred<string>()
    const resource = createResource<string>({ load: () => pending.promise })

    const staleRequest = resource.refresh()
    resource.setData("pushed")

    pending.resolve("stale")
    await staleRequest

    expect(resource.getSnapshot()).toMatchObject({ data: "pushed", status: "ready" })
  })

  it("invalidates an in-flight request and allows a fresh request to start", async () => {
    const stale = deferred<string>()
    const fresh = deferred<string>()
    let calls = 0
    const resource = createResource<string>({
      load: () => {
        calls += 1
        return calls === 1 ? stale.promise : fresh.promise
      },
    })

    resource.setData("current")
    const staleRequest = resource.refresh({ forceRefresh: true })
    resource.invalidate()
    const freshRequest = resource.refresh()

    expect(calls).toBe(2)
    stale.resolve("stale")
    await staleRequest
    expect(resource.getSnapshot().data).toBe("current")

    fresh.resolve("fresh")
    await freshRequest
    expect(resource.getSnapshot().data).toBe("fresh")
  })

  it("returns an empty resource to idle when its initial request is invalidated", async () => {
    const pending = deferred<string>()
    const resource = createResource<string>({ load: () => pending.promise })

    const staleRequest = resource.refresh()
    resource.invalidate()

    expect(resource.getSnapshot()).toEqual({ data: null, error: null, status: "idle", updatedAt: null })

    pending.resolve("stale")
    await staleRequest
    expect(resource.getSnapshot()).toEqual({ data: null, error: null, status: "idle", updatedAt: null })
  })
})
