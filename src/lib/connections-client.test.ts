import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearConnectorCache,
  connectorCacheEntryCountsForTest,
  connectProvider,
  getActiveConnectionAppIdsForService,
  getConnectionAppDetail,
  getConnectionActions,
  getConnectionCatalogSummary,
  getConnectionExecutionLogs,
  getConnectionLingxingErpUsers,
  getConnectionProviderDetail,
  getConnectionSummary,
  listOAuthClientConfigs,
  setDefaultConnection,
  startOAuthConnect,
  upsertOAuthClientConfig,
} from "./connections-client.ts"
import { consoleBaseUrl } from "./domain.ts"

const managementWorkspace = { manageable: true, teamName: "team-name" } as const

describe("connections-client", () => {
  afterEach(() => {
    clearConnectorCache()
    vi.useRealTimers()
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
      getActiveConnectionAppIdsForService("gmail", { manageable: false, teamName: "team-name" }),
    ).resolves.toEqual(["app-1", "app-2"])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps")
  })

  it("sends the team header for team workspaces", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await getActiveConnectionAppIdsForService("gmail", { manageable: false, teamName: "acme-corp" })

    const [, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(headers.get("x-oo-team-name")).toBe("acme-corp")
    expect(headers.has("x-oo-organization-name")).toBe(false)
  })

  it("separates management connections from policy-visible member apps", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/connections")) {
        return Response.json({ data: [{ id: "managed", service: "github", status: "active" }] })
      }
      if (url.includes("/v1/apps")) {
        return Response.json({ data: [{ id: "visible", service: "github", status: "active" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getActiveConnectionAppIdsForService("github", managementWorkspace)).resolves.toEqual(["managed"])
    await expect(
      getActiveConnectionAppIdsForService("github", { manageable: false, teamName: "team-name" }),
    ).resolves.toEqual(["visible"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects connection mutations from a policy-visible member workspace", async () => {
    await expect(
      connectProvider({ authType: "no_auth", service: "github" }, { manageable: false, teamName: "team-name" }),
    ).rejects.toThrow("Connection management is not allowed")
    await expect(
      setDefaultConnection("tikhub", "marketplace:oomol:tikhub", {
        manageable: false,
        teamName: "team-name",
      }),
    ).rejects.toThrow("Connection management is not allowed")
  })

  it("sets a Marketplace virtual app as the service default", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }))
    vi.stubGlobal("fetch", fetchMock)

    await setDefaultConnection("tikhub", "marketplace:oomol:tikhub", managementWorkspace)

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/connections/services/tikhub/default")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      appId: "marketplace:oomol:tikhub",
    })
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

    await expect(getConnectionAppDetail("app-1", { manageable: false, teamName: "team-name" })).resolves.toMatchObject({
      id: "app-1",
      credentialFields: [{ key: "roleArn", label: "Role ARN", displayValue: "role-a", secret: false }],
    })
    await expect(getConnectionAppDetail("app-1", { manageable: false, teamName: "team-name" })).resolves.toMatchObject({
      id: "app-1",
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/by-id/app-1")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("loads Lingxing ERP users from the scoped management connection", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ id: "erp-1", displayName: "Alice", status: "active" }] }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionLingxingErpUsers("app-1", managementWorkspace)).resolves.toMatchObject({
      data: [{ id: "erp-1", displayName: "Alice" }],
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/connections/by-id/app-1/lingxing/erp-users")
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get("x-oo-team-name")).toBe("team-name")
  })

  it("loads the global Action catalog for a provider without a Team header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            description: "List issues",
            id: "github.list_issues",
            name: "list_issues",
            operationType: "read",
            providerPermissions: [],
            requiredScopes: [],
            service: "github",
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionActions("github", {}, "zh-CN")).resolves.toMatchObject({
      data: [{ name: "list_issues", operationType: "read" }],
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/actions?service=github&locale=zh-CN")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("x-oo-team-name")).toBe(false)
  })

  it("bounds cache versions after an evicted request rejects", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("service=rejected")) throw new Error("request failed")
      return Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    for (let index = 0; index < 260; index += 1) {
      await getConnectionActions(`service-${index}`)
    }
    await expect(getConnectionActions("rejected")).rejects.toThrow("request failed")

    const counts = connectorCacheEntryCountsForTest()
    expect(counts.cache).toBeLessThanOrEqual(256)
    expect(counts.inFlight).toBe(0)
    expect(counts.versions).toBe(counts.cache)
  })

  it("keeps an in-flight cached entry attached when a 304 response arrives after pruning", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-20T00:00:00Z"))
    let resolveRefresh: ((response: Response) => void) | undefined
    let targetRequests = 0
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).includes("service=target")) {
        targetRequests += 1
        if (targetRequests === 1) {
          return Promise.resolve(Response.json({ data: [] }, { headers: { etag: '"target-v1"' } }))
        }
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve
        })
      }
      return Promise.resolve(Response.json({ data: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)

    await getConnectionActions("target")
    vi.setSystemTime(new Date("2026-08-20T00:01:00Z"))
    const refresh = getConnectionActions("target")
    for (let index = 0; index < 260; index += 1) {
      await getConnectionActions(`other-${index}`)
    }
    resolveRefresh?.(new Response(null, { status: 304 }))
    await refresh
    await getConnectionActions("target")

    expect(targetRequests).toBe(2)
    vi.useRealTimers()
  })

  it("returns the provider catalog without requesting usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json({ data: [{ id: "app-1", service: "gmail", status: "active" }] })
      }
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["oauth2"], displayName: "Gmail", service: "gmail" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const summary = await getConnectionCatalogSummary({ manageable: false, teamName: "team-name" }, {}, "zh-CN")

    expect(summary.providers.map((provider) => provider.service)).toEqual(["gmail"])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([expect.stringContaining("/v1/apps"), expect.stringContaining("/v1/providers")]),
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/usage/"))).toBe(false)
    const providerRequest = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/providers"))
    expect(String(providerRequest?.[0])).toContain("/v1/providers?locale=zh-CN")
    const providerHeaders = new Headers(providerRequest?.[1]?.headers)
    expect(providerHeaders.has("x-oo-organization-name")).toBe(false)
  })

  it("preserves a policy-visible Marketplace app for read-only team members", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json({
          data: [
            {
              authType: "marketplace",
              connectionName: "marketplace_oomol",
              id: "marketplace:oomol:tikhub",
              isDefault: true,
              marketplace: { id: "oomol", pricing: "metered" },
              service: "tikhub",
              status: "active",
            },
          ],
        })
      }
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["api_key"], displayName: "TikHub", service: "tikhub" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const summary = await getConnectionCatalogSummary({ manageable: false, teamName: "read-only-team" })

    expect(summary.appsStatus).toBe("ready")
    expect(summary.providers[0]).toMatchObject({
      appAuthType: "marketplace",
      appCount: 1,
      canDisconnect: false,
      status: "connected",
    })
    expect(summary.providers[0]?.apps[0]).toMatchObject({
      connectionName: "marketplace_oomol",
      marketplace: { id: "oomol", pricing: "metered" },
    })
  })

  it("loads execution logs for one connection through the by-id endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          data: [
            {
              action: "list_threads",
              executionId: "exec-1",
              finishedAt: "2026-07-24T10:00:01.000Z",
              service: "gmail",
              startedAt: "2026-07-24T10:00:00.000Z",
              status: "success",
            },
          ],
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionExecutionLogs({ appId: "app-1", limit: 12 }, managementWorkspace)).resolves.toMatchObject(
      { items: [{ id: "exec-1", service: "gmail" }] },
    )

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/connections/by-id/app-1/executions?limit=12")
  })

  it("loads provider detail without rereading apps or usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/providers/github")) {
        return Response.json({ data: { authTypes: ["oauth2"], displayName: "GitHub", service: "github" } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionProviderDetail("github", "zh-CN")).resolves.toMatchObject({
      displayName: "GitHub",
      service: "github",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/providers/github?locale=zh-CN")
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.has("x-oo-organization-name")).toBe(false)
  })

  it("keeps the provider catalog visible when team apps are forbidden", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json(
          { code: "organization_connection_read_forbidden", message: "Connection management is not allowed" },
          { status: 403, statusText: "Forbidden" },
        )
      }
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["oauth2"], displayName: "Gmail", service: "gmail" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionCatalogSummary({ manageable: false, teamName: "read-only-team" })).resolves.toMatchObject(
      {
        apps: [],
        appsStatus: "forbidden",
        providerCount: 1,
        providers: [{ displayName: "Gmail", service: "gmail", status: "available" }],
      },
    )
  })

  it("keeps the provider catalog visible when team apps are temporarily unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json(
          { code: "organization_service_account_unavailable", message: "Service account unavailable" },
          { status: 503, statusText: "Service Unavailable" },
        )
      }
      if (url.includes("/v1/providers")) {
        return Response.json({ data: [{ authTypes: ["oauth2"], displayName: "Slack", service: "slack" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionCatalogSummary({ manageable: false, teamName: "read-only-team" })).resolves.toMatchObject(
      {
        appsStatus: "unavailable",
        providers: [{ displayName: "Slack", service: "slack" }],
      },
    )
  })

  it("preserves provider response diagnostics when the public catalog fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/v1/apps")) {
        return Response.json({ data: [] })
      }
      if (url.includes("/v1/providers")) {
        return Response.json(
          { code: "catalog_unavailable", message: "Provider index is rebuilding" },
          { status: 503, statusText: "Service Unavailable" },
        )
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getConnectionCatalogSummary({ manageable: false, teamName: "team-name" })).rejects.toMatchObject({
      apiMessage: "Provider index is rebuilding",
      code: "catalog_unavailable",
      message: expect.stringContaining("Provider index is rebuilding"),
      path: "/v1/providers",
      status: 503,
    })
  })

  it("sends a dev app protocol in the OAuth return URI from the Vite renderer", async () => {
    vi.stubGlobal("window", { location: { protocol: "http:" } })
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await startOAuthConnect({ authType: "oauth2", service: "figma" }, managementWorkspace)

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
        authorizationScopes: ["tweet.read", "users.read"],
        extra: { scopes: ["tweet.read", "users.read"] },
        secretExtra: { appBearerToken: "secret" },
      },
      managementWorkspace,
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.authorizationScopes).toEqual(["tweet.read", "users.read"])
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
      managementWorkspace,
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({ apiKey: "secret", comment: "developer role", extra: { workspace: "prod" } })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/connections/by-id/app-1/connect/api-key")
  })

  it("keeps the global provider catalog cached after a workspace connection mutation", async () => {
    let appReads = 0
    let providerReads = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith("/v1/connections") && (!init?.method || init.method === "GET")) {
        appReads += 1
        return Response.json({ data: [] })
      }
      if (url.endsWith("/v1/providers")) {
        providerReads += 1
        return Response.json({ data: [{ authTypes: ["no_auth"], service: "demo" }] })
      }
      if (url.includes("/v1/connections/demo/connect/no-auth")) {
        return Response.json({ data: {} })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const workspace = managementWorkspace

    await getConnectionCatalogSummary(workspace)
    await connectProvider({ authType: "no_auth", service: "demo" }, workspace)
    await getConnectionCatalogSummary(workspace)

    expect(appReads).toBe(2)
    expect(providerReads).toBe(1)
  })

  it("invalidates all workspace app detail caches after a service-level connection mutation", async () => {
    const detailReads = new Map<string, number>()
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const appId = /\/v1\/connections\/by-id\/(app-[12])/.exec(url)?.[1]
      if (appId && (!init?.method || init.method === "GET")) {
        detailReads.set(appId, (detailReads.get(appId) ?? 0) + 1)
        return Response.json({ data: { id: appId, service: "demo", status: "active" } })
      }
      if (url.includes("/v1/connections/demo/connect/no-auth")) {
        return Response.json({ data: {} })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const workspace = managementWorkspace

    await Promise.all([getConnectionAppDetail("app-1", workspace), getConnectionAppDetail("app-2", workspace)])
    await Promise.all([getConnectionAppDetail("app-1", workspace), getConnectionAppDetail("app-2", workspace)])
    expect(detailReads).toEqual(
      new Map([
        ["app-1", 1],
        ["app-2", 1],
      ]),
    )

    await connectProvider({ authType: "no_auth", service: "demo" }, workspace)
    await Promise.all([getConnectionAppDetail("app-1", workspace), getConnectionAppDetail("app-2", workspace)])

    expect(detailReads).toEqual(
      new Map([
        ["app-1", 2],
        ["app-2", 2],
      ]),
    )
  })

  it("deduplicates identical concurrent OAuth start requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([
      startOAuthConnect({ authType: "oauth2", service: "gmail" }, managementWorkspace),
      startOAuthConnect({ authType: "oauth2", service: "gmail" }, managementWorkspace),
    ])

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/connections/gmail/connect")
  })

  it("keeps OAuth start requests with different app IDs separate", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await Promise.all([
      startOAuthConnect({ appId: "app-1", authType: "oauth2", service: "gmail" }, managementWorkspace),
      startOAuthConnect({ appId: "app-2", authType: "oauth2", service: "gmail" }, managementWorkspace),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/connections/by-id/app-1/connect")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/connections/by-id/app-2/connect")
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
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const request = { forceRefresh: true, refreshGeneration: "workspace:team:team-name:refresh-1" }
    await Promise.all([
      getConnectionSummary({ manageable: false, teamName: "team-name" }, request),
      getConnectionSummary({ manageable: false, teamName: "team-name" }, request),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
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

    const first = getActiveConnectionAppIdsForService("gmail", { manageable: false, teamName: "team-name" })
    const second = getActiveConnectionAppIdsForService("gmail", { manageable: false, teamName: "team-name" })
    resolveSecondApps(
      Response.json({ data: [{ authType: "oauth2", id: "new-app", service: "gmail", status: "active" }] }),
    )
    await expect(second).resolves.toEqual(["new-app"])
    resolveFirstApps(
      Response.json({ data: [{ authType: "oauth2", id: "old-app", service: "gmail", status: "active" }] }),
    )
    await expect(first).resolves.toEqual(["old-app"])

    const summary = await getConnectionSummary({ manageable: false, teamName: "team-name" })
    expect(summary.apps.map((app) => app.id)).toEqual(["new-app"])
    expect(appsRequestCount).toBe(2)
  })
})
