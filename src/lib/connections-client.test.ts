import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearConnectorCache,
  connectProvider,
  getActiveConnectionAppIdsForService,
  getConnectionAppDetail,
  getConnectionCatalogSummary,
  getConnectionSummary,
  getConnectionUsageSummary,
  isProviderConnectionActive,
  listOAuthClientConfigs,
  startOAuthConnect,
  upsertOAuthClientConfig,
} from "./connections-client.ts"
import { consoleBaseUrl } from "./domain.ts"

describe("connections-client", () => {
  afterEach(() => {
    clearConnectorCache()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("checks provider connection state through the apps endpoint only", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          { id: "app-1", service: "gmail", status: "active" },
          { id: "app-2", service: "gmail", status: "active" },
          { service: "slack", status: "reauth_required" },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      isProviderConnectionActive("gmail", { type: "organization", organizationName: "org-name" }),
    ).resolves.toBe(true)
    await expect(
      isProviderConnectionActive("slack", { type: "organization", organizationName: "org-name" }),
    ).resolves.toBe(false)
    await expect(
      getActiveConnectionAppIdsForService("gmail", { type: "organization", organizationName: "org-name" }),
    ).resolves.toEqual(["app-1", "app-2"])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps")
  })

  it("sends the organization header for organization workspaces", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await isProviderConnectionActive("gmail", { type: "organization", organizationName: "acme-corp" })

    const [, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(headers.get("x-oo-organization-name")).toBe("acme-corp")
  })

  it("loads connection app details through the by-id endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          id: "app-1",
          service: "aliyun_sts",
          authType: "federated",
          status: "active",
          credentialFields: [{ key: "roleArn", label: "Role ARN", displayValue: "role-a", secret: false }],
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      getConnectionAppDetail("app-1", { type: "organization", organizationName: "org-name" }),
    ).resolves.toMatchObject({
      id: "app-1",
      credentialFields: [{ key: "roleArn", label: "Role ARN", displayValue: "role-a", secret: false }],
    })
    await expect(
      getConnectionAppDetail("app-1", { type: "organization", organizationName: "org-name" }),
    ).resolves.toMatchObject({ id: "app-1" })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/by-id/app-1")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns the provider catalog before requesting background usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json({ data: [{ id: "app-1", service: "gmail", status: "active" }] })
      }
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["oauth2"], displayName: "Gmail", service: "gmail" }] })
      }
      if (url.includes("/v1/usage/daily")) {
        return Response.json({ data: [{ date: "2026-07-10", totalCount: 3 }] })
      }
      if (url.includes("/v1/usage/services")) {
        return Response.json({ data: [{ service: "gmail", totalCount: 3 }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const summary = await getConnectionCatalogSummary({ type: "organization", organizationName: "org-name" })

    expect(summary.providers.map((provider) => provider.service)).toEqual(["gmail"])
    expect(summary.usageLoading).toBe(true)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([expect.stringContaining("/v1/apps"), expect.stringContaining("/v1/providers")]),
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/usage/"))).toBe(false)

    const usage = await getConnectionUsageSummary({ type: "organization", organizationName: "org-name" })

    expect(usage.calls).toBe(3)
    expect(usage.services).toMatchObject([{ calls: 3, service: "gmail" }])
  })

  it("degrades a failed usage request to an empty summary without rejecting", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/usage/daily")) {
        return new Response("unavailable", { status: 503, statusText: "Service Unavailable" })
      }
      if (url.includes("/v1/usage/services")) {
        return Response.json({ data: [{ service: "gmail", totalCount: 3 }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionUsageSummary({ type: "organization", organizationName: "org-name" })).resolves.toEqual({
      calls: 0,
      days: 7,
      errors: 0,
      points: [],
      recent: null,
      services: [],
      success: 0,
    })
    expect(warning).toHaveBeenCalledOnce()
  })

  it("sends a dev app protocol in the OAuth return URI from the Vite renderer", async () => {
    vi.stubGlobal("window", { location: { protocol: "http:" } })
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await startOAuthConnect(
      { authType: "oauth2", service: "figma" },
      { type: "organization", organizationName: "org-name" },
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.returnUri).toBe(`${consoleBaseUrl}/app-connections/callback?protocol=wanta-local`)
  })

  it("passes OAuth connect-only fields to the connector", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await startOAuthConnect(
      {
        authType: "oauth2",
        service: "twitter",
        extra: { scopes: ["tweet.read", "users.read"] },
        secretExtra: { appBearerToken: "secret" },
      },
      { type: "organization", organizationName: "org-name" },
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.extra).toEqual({ scopes: ["tweet.read", "users.read"] })
    expect(body.secretExtra).toEqual({ appBearerToken: "secret" })
  })

  it("passes comments when reconnecting non-OAuth credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: { id: "app-1" } }))
    vi.stubGlobal("fetch", fetchMock)

    await connectProvider(
      {
        apiKey: "secret",
        appId: "app-1",
        authType: "api_key",
        comment: "developer role",
        extra: { workspace: "prod" },
        service: "ably",
      },
      { type: "organization", organizationName: "org-name" },
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({ apiKey: "secret", comment: "developer role", extra: { workspace: "prod" } })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/by-id/app-1/connect/api-key")
  })

  it("deduplicates identical concurrent OAuth start requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([
      startOAuthConnect(
        { authType: "oauth2", service: "gmail" },
        { type: "organization", organizationName: "org-name" },
      ),
      startOAuthConnect(
        { authType: "oauth2", service: "gmail" },
        { type: "organization", organizationName: "org-name" },
      ),
    ])

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/gmail/connect")
  })

  it("keeps OAuth start requests with different app IDs separate", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await Promise.all([
      startOAuthConnect(
        { appId: "app-1", authType: "oauth2", service: "gmail" },
        { type: "organization", organizationName: "org-name" },
      ),
      startOAuthConnect(
        { appId: "app-2", authType: "oauth2", service: "gmail" },
        { type: "organization", organizationName: "org-name" },
      ),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/by-id/app-1/connect")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/apps/by-id/app-2/connect")
  })

  it("deduplicates force-refresh requests within the same refresh generation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json({ data: [{ id: "app-1", service: "gmail", status: "active" }] })
      }
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["oauth2"], service: "gmail" }] })
      }
      if (url.includes("/v1/usage/daily")) {
        return Response.json({ data: [] })
      }
      if (url.includes("/v1/usage/services")) {
        return Response.json({ data: [] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const request = { forceRefresh: true, refreshGeneration: "workspace:organization:org-name:refresh-1" }
    await Promise.all([
      getConnectionSummary({ type: "organization", organizationName: "org-name" }, request),
      getConnectionSummary({ type: "organization", organizationName: "org-name" }, request),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("shares OAuth client config reads and clears them after an update", async () => {
    let configReads = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/v1/oauth-client-configs/gmail") && init?.method === "PUT") {
        return Response.json({ data: { configured: true, service: "gmail" } })
      }
      if (url.includes("/v1/oauth-client-configs")) {
        configReads += 1
        return Response.json({ data: [{ configured: true, service: "gmail" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([listOAuthClientConfigs(), listOAuthClientConfigs()])
    await listOAuthClientConfigs()
    await upsertOAuthClientConfig("gmail", { clientId: "client-id" })
    await listOAuthClientConfigs()

    expect(first).toEqual(second)
    expect(configReads).toBe(2)
  })

  it("keeps the newest force-refresh response in the per-path cache", async () => {
    let resolveFirstApps: (response: Response) => void = () => undefined
    let resolveSecondApps: (response: Response) => void = () => undefined
    let appsRequestCount = 0
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith("/v1/apps")) {
        appsRequestCount += 1
        return new Promise<Response>((resolve) => {
          if (appsRequestCount === 1) {
            resolveFirstApps = resolve
          } else {
            resolveSecondApps = resolve
          }
        })
      }
      return Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    const first = getActiveConnectionAppIdsForService("gmail", { type: "organization", organizationName: "org-name" })
    const second = getActiveConnectionAppIdsForService("gmail", { type: "organization", organizationName: "org-name" })
    resolveSecondApps(Response.json({ data: [{ id: "new-app", service: "gmail", status: "active" }] }))
    await expect(second).resolves.toEqual(["new-app"])
    resolveFirstApps(Response.json({ data: [{ id: "old-app", service: "gmail", status: "active" }] }))
    await expect(first).resolves.toEqual(["old-app"])

    const summary = await getConnectionSummary({ type: "organization", organizationName: "org-name" })
    expect(summary.apps.map((app) => app.id)).toEqual(["new-app"])
    expect(appsRequestCount).toBe(2)
  })
})
