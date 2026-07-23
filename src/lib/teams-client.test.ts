import { afterEach, describe, expect, it, vi } from "vitest"
import { clearConnectorCache } from "./connections-client.ts"
import {
  addTeamMember,
  createTeam,
  disableTeamMembers,
  enableTeamMembers,
  getTeamAppAccess,
  getTeamAppAccessSnapshot,
  isTeamMemberLimitError,
  listCreatedTeams,
  listMyTeams,
  listTeamMembers,
  listTeamProviderOptions,
  listUserSummaries,
  removeTeamMember,
  TeamRequestError,
  searchUsers,
  updateTeamAppAccess,
  updateTeamMemberRole,
  updateTeam,
  uploadTeamAvatar,
} from "./teams-client.ts"

describe("teams-client", () => {
  afterEach(() => {
    clearConnectorCache()
    vi.unstubAllGlobals()
  })

  it("reuses connector apps and provider reads for team options", async () => {
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

    await listTeamProviderOptions("acme")
    await listTeamProviderOptions("acme")

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("creates teams through the console API org endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ avatar: "", creator_user_id: "user-1", id: "team-1", name: "acme" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(createTeam({ teamName: " acme " })).resolves.toMatchObject({ id: "team-1", name: "acme" })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain("/v1/orgs")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ org_name: "acme" })
  })

  it("updates team names and avatars through the console API org endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        avatar: "https://img.example/avatar.png",
        creator_user_id: "user-1",
        id: "team-1",
        name: "acme",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      updateTeam({ avatar: " https://img.example/avatar.png ", teamId: "team-1", teamName: " acme " }),
    ).resolves.toMatchObject({ avatar: "https://img.example/avatar.png", name: "acme" })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain("/v1/orgs/team-1")
    expect(init?.method).toBe("PUT")
    expect(JSON.parse(String(init?.body))).toEqual({
      avatar: "https://img.example/avatar.png",
      org_name: "acme",
    })
  })

  it("uploads team avatars as multipart form data without forcing a JSON content type", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ avatar: "https://img.example/avatar.png" }))
    vi.stubGlobal("fetch", fetchMock)

    const file = new File(["avatar"], "avatar.png", { type: "image/png" })
    await expect(uploadTeamAvatar("team-1", file)).resolves.toEqual({
      avatar: "https://img.example/avatar.png",
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(String(url)).toContain("/v1/orgs/team-1/avatar")
    expect(init?.method).toBe("POST")
    expect(init?.body).toBeInstanceOf(FormData)
    expect(headers.get("content-type")).toBeNull()
  })

  it("keeps bare uploaded team avatar filenames for the update API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ avatar: "019eddb2-7587-7e98-88a6-975dc65b672b.png" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(uploadTeamAvatar("team-1", new File(["avatar"], "avatar.png"))).resolves.toEqual({
      avatar: "019eddb2-7587-7e98-88a6-975dc65b672b.png",
    })
  })

  it("classifies team member limit responses", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ message: "organization member limit exceeded" }, { status: 400, statusText: "Bad Request" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const error = await addTeamMember({ teamId: "team-1", userId: "user-1" }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(TeamRequestError)
    expect(error).toMatchObject({
      apiMessage: "organization member limit exceeded",
      message: "HTTP 400: organization member limit exceeded",
      status: 400,
    })
    expect(isTeamMemberLimitError(error)).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain("/v1/teams/team-1/members")
    expect(init?.method).toBe("POST")
  })

  it("uses team endpoints and preserves admin roles in team and member lists", async () => {
    const adminTeam = {
      avatar: "",
      creator_user_id: "creator-1",
      id: "team-1",
      name: "acme",
      role: "admin",
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ teams: [adminTeam] }))
      .mockResolvedValueOnce(Response.json({ teams: [adminTeam] }))
      .mockResolvedValueOnce(
        Response.json({
          members: [
            { disable: false, role: "creator", user_id: "creator-1" },
            { disable: false, role: "admin", user_id: "admin-1" },
            { disable: true, role: "member", user_id: "member-1" },
          ],
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(listCreatedTeams()).resolves.toEqual([adminTeam])
    await expect(listMyTeams()).resolves.toEqual([adminTeam])
    await expect(listTeamMembers("team/1")).resolves.toEqual([
      { disable: false, role: "creator", user_id: "creator-1" },
      { disable: false, role: "admin", user_id: "admin-1" },
      { disable: true, role: "member", user_id: "member-1" },
    ])

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/v1/teams")
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe("/v1/me/teams")
    expect(new URL(String(fetchMock.mock.calls[2]?.[0])).pathname).toBe("/v1/teams/team%2F1/members")
  })

  it("removes team members through the encoded team endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await removeTeamMember({ teamId: "team/1", userId: "user/1" })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(new URL(String(url)).pathname).toBe("/v1/teams/team%2F1/members/user%2F1")
    expect(init?.method).toBe("DELETE")
  })

  it.each(["admin", "member"] as const)(
    "updates team member roles to %s through the encoded team endpoint",
    async (role) => {
      const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ disable: false, role, user_id: "user/1" }))
      vi.stubGlobal("fetch", fetchMock)

      await expect(updateTeamMemberRole({ role, teamId: "team/1", userId: "user/1" })).resolves.toEqual({
        disable: false,
        role,
        user_id: "user/1",
      })

      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(new URL(String(url)).pathname).toBe("/v1/teams/team%2F1/members/user%2F1")
      expect(init?.method).toBe("PUT")
      expect(JSON.parse(String(init?.body))).toEqual({ role })
    },
  )

  it("rejects malformed team member role update responses", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ role: "owner", user_id: "user-1" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(updateTeamMemberRole({ role: "member", teamId: "team-1", userId: "user-1" })).rejects.toThrow(
      "Team member role response is invalid",
    )
  })

  it("keeps member disabled status from team member lists", async () => {
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

    await expect(listTeamMembers("team-1")).resolves.toEqual([
      { disable: false, role: "creator", user_id: "creator-1" },
      { disable: true, role: "member", user_id: "member-1" },
      { role: "member", user_id: "member-2" },
    ])
  })

  it("rejects malformed team and member collection responses instead of treating them as empty", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ teams: null }))
      .mockResolvedValueOnce(Response.json({ members: [{ role: "member" }] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(listCreatedTeams()).rejects.toThrow("Created teams response is invalid")
    await expect(listTeamMembers("team-1")).rejects.toThrow("Team members response contains an invalid member")
  })

  it("rejects malformed app-access responses instead of converting them to writable empty access", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(null))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getTeamAppAccess("team-1")).rejects.toThrow("Team app access response is invalid")
  })

  it("uses app-access ETags to reject stale read-modify-write updates when supported", async () => {
    const access = { users: { "user-1": { providers: ["gmail"] } } }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(access, { headers: { etag: '"revision-1"' } }))
      .mockResolvedValueOnce(Response.json(access))
    vi.stubGlobal("fetch", fetchMock)

    const snapshot = await getTeamAppAccessSnapshot("team/1")
    await updateTeamAppAccess("team/1", snapshot.access, { etag: snapshot.etag })

    const updateHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(snapshot.etag).toBe('"revision-1"')
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/v1/teams/team%2F1/app-access")
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe("/v1/teams/team%2F1/app-access")
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

  it("updates team member status in batches", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await disableTeamMembers({ teamId: "team-1", userIds: ["member-1", "member-1", " "] })
    await enableTeamMembers({ teamId: "team-1", userIds: ["member-2"] })

    const [disableUrl, disableInit] = fetchMock.mock.calls[0] ?? []
    expect(String(disableUrl)).toContain("/v1/teams/team-1/members/disable")
    expect(disableInit?.method).toBe("PUT")
    expect(JSON.parse(String(disableInit?.body))).toEqual({ user_ids: ["member-1"] })

    const [enableUrl, enableInit] = fetchMock.mock.calls[1] ?? []
    expect(String(enableUrl)).toContain("/v1/teams/team-1/members/enable")
    expect(enableInit?.method).toBe("PUT")
    expect(JSON.parse(String(enableInit?.body))).toEqual({ user_ids: ["member-2"] })
  })
})
