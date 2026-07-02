import { afterEach, describe, expect, it, vi } from "vitest"
import { createOrganization, updateOrganization, uploadOrganizationAvatar } from "./organizations-client.ts"

describe("organizations-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates organizations through the console API org endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ avatar: "", creator_user_id: "user-1", id: "org-1", name: "acme" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(createOrganization({ orgName: " acme " })).resolves.toMatchObject({ id: "org-1", name: "acme" })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain("/v1/orgs")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ org_name: "acme" })
  })

  it("updates organization names and avatars through the console API org endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ avatar: "https://img.example/avatar.png", creator_user_id: "user-1", id: "org-1", name: "acme" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      updateOrganization({ avatar: " https://img.example/avatar.png ", orgId: "org-1", orgName: " acme " }),
    ).resolves.toMatchObject({ avatar: "https://img.example/avatar.png", name: "acme" })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain("/v1/orgs/org-1")
    expect(init?.method).toBe("PUT")
    expect(JSON.parse(String(init?.body))).toEqual({
      avatar: "https://img.example/avatar.png",
      org_name: "acme",
    })
  })

  it("uploads organization avatars as multipart form data without forcing a JSON content type", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ avatar: "https://img.example/avatar.png" }))
    vi.stubGlobal("fetch", fetchMock)

    const file = new File(["avatar"], "avatar.png", { type: "image/png" })
    await expect(uploadOrganizationAvatar("org-1", file)).resolves.toEqual({
      avatar: "https://img.example/avatar.png",
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(String(url)).toContain("/v1/orgs/org-1/avatar")
    expect(init?.method).toBe("POST")
    expect(init?.body).toBeInstanceOf(FormData)
    expect(headers.get("content-type")).toBeNull()
  })

  it("keeps bare uploaded organization avatar filenames for the update API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ avatar: "019eddb2-7587-7e98-88a6-975dc65b672b.png" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(uploadOrganizationAvatar("org-1", new File(["avatar"], "avatar.png"))).resolves.toEqual({
      avatar: "019eddb2-7587-7e98-88a6-975dc65b672b.png",
    })
  })
})
