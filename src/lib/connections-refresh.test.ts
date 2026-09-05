import type { UseConnections } from "../hooks/useConnections.ts"
import type { Root } from "react-dom/client"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  clearOAuthPendingOperation,
  readOAuthPendingOperationsForWorkspace,
} from "../hooks/connection-oauth-pending.ts"
import { useConnections } from "../hooks/useConnections.ts"
import {
  getConnectionApps,
  getActiveConnectionAppIdsForService,
  clearConnectorCache,
  getConnectionProviders,
  getConnectionProviderDetail,
  upsertOAuthClientConfig,
  getConnectionAppDetail,
  disconnectAccount,
  connectorCacheEntryCountsForTest,
  getConnectionCatalogSummary,
} from "./connections-client.ts"

const { chatService } = vi.hoisted(() => ({ chatService: { invoke: vi.fn(async () => undefined) } }))
vi.mock("../components/AppContext.ts", () => ({ useChatService: () => chatService }))
vi.mock("../i18n/i18n", () => ({ useI18n: () => ({ locale: "en" }) }))
vi.mock("./renderer-diagnostics", () => ({ reportRendererHandledError: vi.fn() }))
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true))
const workspace = { manageable: true, teamName: "audit-team" }
let root: Root | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  clearConnectorCache()
  localStorage.clear()
  sessionStorage.clear()
  vi.useRealTimers()
  for (const pending of readOAuthPendingOperationsForWorkspace(workspace)) clearOAuthPendingOperation(pending.key)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("invalidates all localized provider entries after OAuth config updates", async () => {
  const requests: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      requests.push(url)
      if (init?.method === "PUT") return Response.json({ data: { service: "gmail", configured: true } })
      const provider = { service: "gmail", displayName: "Old provider", authTypes: ["oauth2"] }
      return Response.json({ data: url.includes("/providers/gmail") ? provider : [provider] })
    }),
  )
  await getConnectionProviders({}, "en")
  await getConnectionProviderDetail("gmail", "en")
  await upsertOAuthClientConfig("gmail", { clientId: "updated" })
  await getConnectionProviders({}, "en")
  await getConnectionProviderDetail("gmail", "en")
  expect(requests).toHaveLength(5)
})

test("reclaims invalidated detail versions for completed requests", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const id = String(input).split("/").at(-1)
      return Response.json({ data: init?.method === "DELETE" ? {} : { id, service: "gmail", status: "active" } })
    }),
  )
  for (let index = 0; index < 300; index += 1) {
    await getConnectionAppDetail(`audit-${index}`, workspace)
    await disconnectAccount(`audit-${index}`, workspace)
  }
  expect(connectorCacheEntryCountsForTest()).toEqual({ cache: 0, inFlight: 0, versions: 0 })
})

test("publishes the public catalog while account requests are still pending", async () => {
  let finishApps!: (response: Response) => void
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      if (String(input).includes("/v1/connections"))
        return new Promise<Response>((resolve) => {
          finishApps = resolve
        })
      return Response.json({ data: [{ service: "gmail", authTypes: ["oauth2"] }] })
    }),
  )
  let settled = false
  const onProvidersLoaded = vi.fn()
  const request = getConnectionCatalogSummary(workspace, { onProvidersLoaded }).then((value) => {
    settled = true
    return value
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(settled).toBe(false)
  expect(onProvidersLoaded).toHaveBeenCalledWith(
    expect.objectContaining({
      appsStatus: "loading",
      providers: expect.arrayContaining([expect.objectContaining({ service: "gmail" })]),
    }),
  )
  finishApps(Response.json({ data: [] }))
  await request
  expect(settled).toBe(true)
})

async function mountConnections(): Promise<() => UseConnections> {
  let current!: UseConnections
  function Probe() {
    current = useConnections(workspace)
    return null
  }
  root = createRoot(document.createElement("div"))
  await act(async () => {
    root!.render(React.createElement(Probe))
  })
  return () => current
}

test("keeps a successful write successful when subsequent catalog revalidation fails", async () => {
  let written = false
  let now = Date.now()
  vi.spyOn(Date, "now").mockImplementation(() => now)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        written = true
        now += 31_000
        return Response.json({ data: {} })
      }
      if (String(input).includes("/v1/providers"))
        return written
          ? Response.json({ message: "unavailable" }, { status: 503 })
          : Response.json({ data: [{ service: "gmail", authTypes: ["oauth2"] }] })
      return Response.json({ data: [{ id: "app-1", service: "gmail", authType: "oauth2", status: "active" }] })
    }),
  )
  const current = await mountConnections()
  expect(current().summary?.apps).toHaveLength(1)
  let result: boolean | undefined
  await act(async () => {
    result = await current().updateAlias("app-1", "new alias")
  })
  expect(written).toBe(true)
  expect(result).toBe(true)
  expect(current().actionError).toBeNull()
  expect(current().summaryError).not.toBeNull()
})

test("preserves confirmed accounts when post-write account revalidation fails", async () => {
  let written = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        written = true
        return Response.json({ data: {} })
      }
      if (String(input).includes("/v1/providers"))
        return Response.json({ data: [{ service: "gmail", authTypes: ["oauth2"] }] })
      return written
        ? Response.json({ message: "unavailable" }, { status: 503 })
        : Response.json({ data: [{ id: "app-1", service: "gmail", authType: "oauth2", status: "active" }] })
    }),
  )
  const current = await mountConnections()
  expect(current().summary?.apps).toHaveLength(1)
  await act(async () => {
    await current().updateAlias("app-1", "new alias")
  })
  expect(current().summary?.appsStatus).toBe("unavailable")
  expect(current().summary?.apps).toHaveLength(1)
})

test("account mutations reuse a fresh public catalog", async () => {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") return Response.json({ data: {} })
    if (String(input).includes("/v1/providers"))
      return Response.json({ data: [{ service: "gmail", authTypes: ["oauth2"] }] })
    return Response.json({ data: [{ id: "app-1", service: "gmail", authType: "oauth2", status: "active" }] })
  })
  vi.stubGlobal("fetch", fetchMock)
  const current = await mountConnections()
  await act(async () => {
    expect(await current().updateAlias("app-1", "new alias")).toBe(true)
  })
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/providers"))).toHaveLength(1)
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/connections"))).toHaveLength(3)
})

test("transient OAuth polling failures preserve pending authorization and cancellation aborts its own HTTP request", async () => {
  vi.useFakeTimers()
  let polls = 0
  let authorized = false
  let pollSignal: AbortSignal | undefined
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") {
        authorized = true
        return Response.json({ data: { authorizationUrl: "https://accounts.example.test/oauth" } })
      }
      if (url.includes("/v1/providers")) return Response.json({ data: [{ service: "gmail", authTypes: ["oauth2"] }] })
      if (authorized) {
        polls += 1
        if (polls === 1) return Response.json({ message: "try later" }, { status: 503 })
        pollSignal = init?.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          pollSignal!.addEventListener("abort", () => reject(pollSignal!.reason), { once: true })
        })
      }
      return Response.json({ data: [] })
    }),
  )
  const current = await mountConnections()
  let connecting!: Promise<boolean>
  await act(async () => {
    connecting = current().connect({ authType: "oauth2", service: "gmail" })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(polls).toBe(1)
  expect(current().polling).toBe("gmail")
  expect(readOAuthPendingOperationsForWorkspace(workspace)).toHaveLength(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(polls).toBe(2)
  expect(pollSignal?.aborted).toBe(false)
  await act(async () => {
    current().cancelPolling()
    expect(await connecting).toBe(false)
  })
  expect(pollSignal?.aborted).toBe(true)
  expect(current().polling).toBeNull()
  expect(readOAuthPendingOperationsForWorkspace(workspace)).toHaveLength(0)
})

test("cold-start hook exposes a read-only public catalog before accounts finish", async () => {
  let finishApps!: (response: Response) => void
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      if (String(input).includes("/v1/providers"))
        return Response.json({ data: [{ service: "gmail", authTypes: ["oauth2"] }] })
      return new Promise<Response>((resolve) => {
        finishApps = resolve
      })
    }),
  )
  const current = await mountConnections()
  expect(current().summary?.providers[0]?.service).toBe("gmail")
  expect(current().summary?.appsStatus).toBe("loading")
  await act(async () => {
    finishApps(Response.json({ data: [] }))
  })
  expect(current().summary?.appsStatus).toBe("ready")
})

test("invalidated in-flight details cannot replace a newer response after version cleanup", async () => {
  let finishOld!: (response: Response) => void
  let reads = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "DELETE") return Response.json({ data: {} })
      if (++reads === 1)
        return new Promise<Response>((resolve) => {
          finishOld = resolve
        })
      return Response.json({
        data: { id: "app-1", service: "gmail", authType: "oauth2", status: "active", alias: "new" },
      })
    }),
  )
  const oldRead = getConnectionAppDetail("app-1", workspace)
  await disconnectAccount("app-1", workspace)
  const fresh = await getConnectionAppDetail("app-1", workspace)
  finishOld(
    Response.json({ data: { id: "app-1", service: "gmail", authType: "oauth2", status: "active", alias: "old" } }),
  )
  await oldRead
  expect(await getConnectionAppDetail("app-1", workspace)).toEqual(fresh)
  expect(reads).toBe(2)
})

test("canceling a conditional poll does not cancel another consumer or discard validators", async () => {
  const finishes: Array<(response: Response) => void> = []
  const signals: AbortSignal[] = []
  let reads = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (++reads === 1) return Response.json({ data: [] }, { headers: { etag: '"apps-v1"' } })
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"apps-v1"')
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      return new Promise<Response>((resolve, reject) => {
        finishes.push(resolve)
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    }),
  )
  await getConnectionApps(workspace)
  const abort = new AbortController()
  const polling = getActiveConnectionAppIdsForService("gmail", workspace, abort.signal)
  const rejected = expect(polling).rejects.toMatchObject({ name: "AbortError" })
  const otherRead = getConnectionApps(workspace, { forceRefresh: true, refreshGeneration: "manual-refresh" })
  abort.abort()
  await rejected
  expect(signals[0]?.aborted).toBe(true)
  expect(signals[1]?.aborted).toBe(false)
  finishes[1]!(new Response(null, { status: 304 }))
  expect((await otherRead).data).toEqual([])
})
