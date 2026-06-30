import { afterEach, describe, expect, it, vi } from "vitest"
import { clearConnectorCache, getConnectionSummary, isProviderConnectionActive } from "./connections-client.ts"

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

  it("keys cached organization reads by organization id when available", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await getConnectionSummary({ type: "organization", organizationId: "org-a", organizationName: "same-name" })
    await getConnectionSummary({ type: "organization", organizationId: "org-b", organizationName: "same-name" })

    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
})
