import { afterEach, describe, expect, it, vi } from "vitest"
import { clearConnectorCache, isProviderConnectionActive, startOAuthConnect } from "./connections-client.ts"
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
          { service: "gmail", status: "active" },
          { service: "slack", status: "reauth_required" },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(isProviderConnectionActive("gmail", { type: "personal" })).resolves.toBe(true)
    await expect(isProviderConnectionActive("slack", { type: "personal" })).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  it("deduplicates concurrent OAuth start requests by workspace and service", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { authorizationUrl: "https://accounts.example.com/oauth" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([
      startOAuthConnect({ authType: "oauth2", service: "gmail" }, { type: "personal" }),
      startOAuthConnect({ appId: "app-1", authType: "oauth2", service: "gmail" }, { type: "personal" }),
    ])

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/apps/gmail/connect")
  })
})
