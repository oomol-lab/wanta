import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearConnectorCache,
  connectProvider,
  getActiveConnectionAppIdsForService,
  getConnectionAppDetail,
  isProviderConnectionActive,
  startOAuthConnect,
} from "./connections-client.ts"
import { consoleBaseUrl } from "./domain.ts"

describe("connections-client", () => {
  afterEach(() => {
    clearConnectorCache()
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

    await expect(isProviderConnectionActive("gmail", { type: "personal" })).resolves.toBe(true)
    await expect(isProviderConnectionActive("slack", { type: "personal" })).resolves.toBe(false)
    await expect(getActiveConnectionAppIdsForService("gmail", { type: "personal" })).resolves.toEqual([
      "app-1",
      "app-2",
    ])

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

    await expect(getConnectionAppDetail("app-1", { type: "personal" })).resolves.toMatchObject({
      id: "app-1",
      credentialFields: [{ key: "roleArn", label: "Role ARN", displayValue: "role-a", secret: false }],
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/by-id/app-1")
  })

  it("sends a dev app protocol in the OAuth return URI from the Vite renderer", async () => {
    vi.stubGlobal("window", { location: { protocol: "http:" } })
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await startOAuthConnect({ authType: "oauth2", service: "figma" }, { type: "personal" })

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
      { type: "personal" },
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
      { type: "personal" },
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
      startOAuthConnect({ authType: "oauth2", service: "gmail" }, { type: "personal" }),
      startOAuthConnect({ authType: "oauth2", service: "gmail" }, { type: "personal" }),
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
      startOAuthConnect({ appId: "app-1", authType: "oauth2", service: "gmail" }, { type: "personal" }),
      startOAuthConnect({ appId: "app-2", authType: "oauth2", service: "gmail" }, { type: "personal" }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/by-id/app-1/connect")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/apps/by-id/app-2/connect")
  })
})
