import { afterEach, describe, expect, it, vi } from "vitest"
import { clearConnectorCache } from "./connections-client.ts"
import {
  addOrganizationMember,
  createOrganization,
  disableOrganizationMembers,
  enableOrganizationMembers,
  getOrganizationAppAccess,
  getOrganizationAppAccessSnapshot,
  isOrganizationMemberLimitError,
  listCreatedOrganizations,
  listOrganizationMembers,
  listOrganizationProviderOptions,
  listUserSummaries,
  OrganizationRequestError,
  searchUsers,
  updateOrganizationAppAccess,
  updateOrganization,
  uploadOrganizationAvatar,
} from "./organizations-client.ts"

describe("organizations-client", () => {
  afterEach(() => {
    clearConnectorCache()
    vi.unstubAllGlobals()
  })

  it("reuses connector apps and provider reads for organization options", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith("/v1/apps")) {
        return Response.json({ data: [{ service: "gmail", status: "active" }] })
      }
      if (url.endsWith("/v1/providers")) {
        return Response.json({ data: [{ displayName: "Gmail", service: "gmail" }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await listOrganizationProviderOptions("acme")
    await listOrganizationProviderOptions("acme")

    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  it("classifies organization member limit responses", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ message: "organization member limit exceeded" }, { status: 400, statusText: "Bad Request" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const error = await addOrganizationMember({ orgId: "org-1", userId: "user-1" }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(OrganizationRequestError)
    expect(error).toMatchObject({
      apiMessage: "organization member limit exceeded",
      message: "HTTP 400: organization member limit exceeded",
      status: 400,
    })
    expect(isOrganizationMemberLimitError(error)).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain("/v1/organizations/org-1/members")
    expect(init?.method).toBe("POST")
  })

  it("keeps member disabled status from organization member lists", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        members: [
          { disable: false, role: "creator", user_id: "creator-1" },
          { disable: true, role: "member", user_id: "member-1" },
          { role: "member", user_id: "member-2" },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(listOrganizationMembers("org-1")).resolves.toEqual([
      { disable: false, role: "creator", user_id: "creator-1" },
      { disable: true, role: "member", user_id: "member-1" },
      { role: "member", user_id: "member-2" },
    ])
  })

  it("rejects malformed organization and member collection responses instead of treating them as empty", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ organizations: null }))
      .mockResolvedValueOnce(Response.json({ members: [{ role: "member" }] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(listCreatedOrganizations()).rejects.toThrow("Created organizations response is invalid")
    await expect(listOrganizationMembers("org-1")).rejects.toThrow(
      "Organization members response contains an invalid member",
    )
  })

  it("rejects malformed app-access responses instead of converting them to writable empty access", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(null))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getOrganizationAppAccess("org-1")).rejects.toThrow("Organization app access response is invalid")
  })

  it("uses app-access ETags to reject stale read-modify-write updates when supported", async () => {
    const access = { users: { "user-1": { providers: ["gmail"] } } }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(access, { headers: { etag: '"revision-1"' } }))
      .mockResolvedValueOnce(Response.json(access))
    vi.stubGlobal("fetch", fetchMock)

    const snapshot = await getOrganizationAppAccessSnapshot("org-1")
    await updateOrganizationAppAccess("org-1", snapshot.access, { etag: snapshot.etag })

    const updateHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(snapshot.etag).toBe('"revision-1"')
    expect(updateHeaders.get("if-match")).toBe('"revision-1"')
  })

  it("loads large user summary sets in bounded URL batches", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const ids = new URL(String(input)).searchParams.getAll("user_ids")
      return Response.json(Object.fromEntries(ids.map((id) => [id, { nickname: id, username: id }])))
    })
    vi.stubGlobal("fetch", fetchMock)
    const ids = Array.from({ length: 205 }, (_, index) => `user-${String(index).padStart(3, "0")}`)

    const summaries = await listUserSummaries([...ids, ids[0]!, " "])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.getAll("user_ids").length)).toEqual([
      100, 100, 5,
    ])
    expect(Object.keys(summaries)).toHaveLength(205)
    expect(summaries[ids[0]!]?.username).toBe(ids[0])
    expect(summaries[ids.at(-1)!]?.username).toBe(ids.at(-1))
  })

  it("combines member-search cancellation with the request deadline", async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ users: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await searchUsers("alice", { signal: controller.signal })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.signal).not.toBe(controller.signal)
    controller.abort()
    expect(init?.signal?.aborted).toBe(true)
  })

  it("updates organization member status in batches", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await disableOrganizationMembers({ orgId: "org-1", userIds: ["member-1", "member-1", " "] })
    await enableOrganizationMembers({ orgId: "org-1", userIds: ["member-2"] })

    const [disableUrl, disableInit] = fetchMock.mock.calls[0] ?? []
    expect(String(disableUrl)).toContain("/v1/organizations/org-1/members/disable")
    expect(disableInit?.method).toBe("PUT")
    expect(JSON.parse(String(disableInit?.body))).toEqual({ user_ids: ["member-1"] })

    const [enableUrl, enableInit] = fetchMock.mock.calls[1] ?? []
    expect(String(enableUrl)).toContain("/v1/organizations/org-1/members/enable")
    expect(enableInit?.method).toBe("PUT")
    expect(JSON.parse(String(enableInit?.body))).toEqual({ user_ids: ["member-2"] })
  })
})
