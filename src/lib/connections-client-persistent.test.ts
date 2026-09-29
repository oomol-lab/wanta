// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearConnectorAccountCache,
  clearConnectorCache,
  connectProvider,
  getCachedConnectionCatalogSummary,
  getConnectionCatalogSummary,
} from "./connections-client.ts"

const sprite = {
  version: "v1",
  pixelRatio: 2,
  iconSize: 64,
  bleed: 2,
  width: 256,
  height: 128,
  lightUrl: "https://example.com/light.png",
  darkUrl: "https://example.com/dark.png",
}

const workspace = { manageable: true, teamName: "acme" } as const

describe("connections client persistent hydration", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    clearConnectorCache()
  })

  afterEach(() => {
    clearConnectorAccountCache()
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("hydrates a summary and revalidates both inventories with ETags", async () => {
    let revalidate = false
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (revalidate) return new Response(null, { status: 304 })
      if (url.includes("/v1/connections")) {
        return Response.json(
          { data: [{ authType: "oauth2", id: "app-1", service: "github", status: "active" }] },
          { headers: { etag: '"apps-v1"' } },
        )
      }
      if (url.includes("/v1/providers")) {
        return Response.json(
          {
            data: [
              { authTypes: ["oauth2"], displayName: "GitHub", service: "github", iconSpritePosition: { x: 64, y: 0 } },
            ],
            meta: { iconSprite: sprite },
          },
          { headers: { etag: '"providers-v1"' } },
        )
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await getConnectionCatalogSummary(workspace, {}, "en")
    clearConnectorCache()
    expect(getCachedConnectionCatalogSummary(workspace, "en")).toMatchObject({
      appsStatus: "ready",
      providers: [
        { displayName: "GitHub", status: "connected", iconSprite: sprite, iconSpritePosition: { x: 64, y: 0 } },
      ],
    })

    revalidate = true
    fetchMock.mockClear()
    await expect(getConnectionCatalogSummary(workspace, { forceRefresh: true }, "en")).resolves.toMatchObject({
      providers: [
        { displayName: "GitHub", status: "connected", iconSprite: sprite, iconSpritePosition: { x: 64, y: 0 } },
      ],
    })
    const appRequest = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/connections"))
    const providerRequest = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/providers"))
    expect(new Headers(appRequest?.[1]?.headers).get("if-none-match")).toBe('"apps-v1"')
    expect(new Headers(providerRequest?.[1]?.headers).get("if-none-match")).toBe('"providers-v1"')
  })

  it("invalidates account-scoped app hydration after a mutation while retaining providers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/connect/no-auth") && init?.method === "POST") return Response.json({ data: {} })
      if (url.includes("/v1/connections")) return Response.json({ data: [] })
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["no_auth"], displayName: "Demo", service: "demo" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await getConnectionCatalogSummary(workspace, {}, "en")
    expect(getCachedConnectionCatalogSummary(workspace, "en")?.appsStatus).toBe("ready")
    await connectProvider({ authType: "no_auth", service: "demo" }, workspace)

    clearConnectorCache()
    expect(getCachedConnectionCatalogSummary(workspace, "en")).toMatchObject({
      apps: [],
      appsStatus: "unavailable",
      providers: [{ displayName: "Demo" }],
    })
    expect(localStorage.length).toBeGreaterThan(0)
    expect(sessionStorage.length).toBe(0)
  })

  it("does not let a pre-mutation app request repopulate persistent state", async () => {
    let resolveApps: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = String(input)
      if (url.includes("/connect/no-auth") && init?.method === "POST") {
        return Promise.resolve(Response.json({ data: {} }))
      }
      if (url.includes("/v1/connections")) {
        return new Promise<Response>((resolve) => {
          resolveApps = resolve
        })
      }
      if (url.includes("/v1/providers")) {
        return Promise.resolve(Response.json({ data: [{ authTypes: ["no_auth"], service: "demo" }] }))
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    const staleRead = getConnectionCatalogSummary(workspace, {}, "en")
    await vi.waitFor(() => expect(resolveApps).toBeTypeOf("function"))
    await connectProvider({ authType: "no_auth", service: "demo" }, workspace)
    resolveApps?.(Response.json({ data: [{ id: "stale-app", service: "demo", status: "active" }] }))
    await staleRead

    expect(sessionStorage.length).toBe(0)
    expect(getCachedConnectionCatalogSummary(workspace, "en")?.appsStatus).toBe("unavailable")
  })

  it("clears account-scoped apps without discarding the public provider catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/connections")) return Response.json({ data: [] })
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["oauth2"], displayName: "GitHub", service: "github" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await getConnectionCatalogSummary(workspace, {}, "en")
    expect(localStorage.length).toBeGreaterThan(0)
    expect(sessionStorage.length).toBeGreaterThan(0)
    clearConnectorAccountCache()

    expect(localStorage.length).toBeGreaterThan(0)
    expect(sessionStorage.length).toBe(0)
  })
})

it("preserves sprite metadata in the early catalog while app inventory is still pending", async () => {
  let finishApps!: (response: Response) => void
  const fetchMock = vi.fn<typeof fetch>((input) => {
    if (String(input).includes("/v1/providers"))
      return Promise.resolve(
        Response.json({
          data: [{ service: "demo", iconSpritePosition: { x: 0, y: 0 } }],
          meta: { iconSprite: sprite },
        }),
      )
    return new Promise<Response>((resolve) => {
      finishApps = resolve
    })
  })
  localStorage.clear()
  sessionStorage.clear()
  clearConnectorCache()
  vi.stubGlobal("fetch", fetchMock)
  const onProvidersLoaded = vi.fn()
  try {
    const pending = getConnectionCatalogSummary(workspace, { onProvidersLoaded })
    await vi.waitFor(() => expect(onProvidersLoaded).toHaveBeenCalledOnce())
    expect(onProvidersLoaded.mock.calls[0][0]).toMatchObject({
      appsStatus: "loading",
      providers: [{ iconSprite: sprite, iconSpritePosition: { x: 0, y: 0 } }],
    })
    finishApps(Response.json({ data: [] }))
    await pending
  } finally {
    clearConnectorAccountCache()
    localStorage.clear()
    sessionStorage.clear()
    vi.unstubAllGlobals()
  }
})
