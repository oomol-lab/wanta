import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearTeamDetailsResources,
  getCachedTeamMembers,
  getCachedTeamConnectionApps,
  getTeamMembersResource,
  getTeamConnectionAppsResource,
  invalidateTeamDetailsResource,
  subscribeTeamMembersResource,
} from "./team-details-resource.ts"

describe("team-details-resource", () => {
  afterEach(() => {
    clearTeamDetailsResources()
    vi.unstubAllGlobals()
  })

  it("deduplicates concurrent member reads for the same account and team", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ members: [{ role: "creator", user_id: "user-1" }] }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([
      getTeamMembersResource("account-1", "team-1"),
      getTeamMembersResource("account-1", "team-1"),
    ])

    expect(first).toEqual([{ role: "creator", user_id: "user-1" }])
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getCachedTeamMembers("account-1", "team-1")).toEqual(first)
  })

  it("keeps a newly inserted pending resource when older entries are protected", async () => {
    const unsubscribes = Array.from({ length: 256 }, (_, index) =>
      subscribeTeamMembersResource("account-1", `protected-${index}`, () => undefined),
    )
    let resolveRequest: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const first = getTeamMembersResource("account-1", "new-team")
    const second = getTeamMembersResource("account-1", "new-team")

    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveRequest?.(Response.json({ members: [{ role: "member", user_id: "user-1" }] }))
    await expect(first).resolves.toEqual([{ role: "member", user_id: "user-1" }])
    expect(getCachedTeamMembers("account-1", "new-team")).toEqual([{ role: "member", user_id: "user-1" }])
    unsubscribes.forEach((unsubscribe) => unsubscribe())
  })

  it("keeps account scopes isolated and refetches after targeted invalidation", async () => {
    let requestCount = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      requestCount += 1
      return Response.json({ members: [{ role: "member", user_id: `user-${requestCount}` }] })
    })
    vi.stubGlobal("fetch", fetchMock)

    await getTeamMembersResource("account-1", "team-1")
    await getTeamMembersResource("account-2", "team-1")
    invalidateTeamDetailsResource("account-1", "team-1")
    const refreshed = await getTeamMembersResource("account-1", "team-1")

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(refreshed).toEqual([{ role: "member", user_id: "user-3" }])
    expect(getCachedTeamMembers("account-2", "team-1")).toEqual([{ role: "member", user_id: "user-2" }])
  })

  it("shares normalized Connection App reads and keeps renamed team scopes isolated", async () => {
    const teamHeaders: string[] = []
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const teamName = new Headers(init?.headers).get("x-oo-team-name") ?? ""
      teamHeaders.push(teamName)
      return Response.json({
        data: [
          {
            authType: "oauth2",
            id: `app-${teamName}`,
            isDefault: false,
            service: "github",
            status: "active",
          },
        ],
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const first = getTeamConnectionAppsResource("account-1", "team-1", "before")
    const duplicate = getTeamConnectionAppsResource("account-1", "team-1", "before")
    const renamed = getTeamConnectionAppsResource("account-1", "team-1", "after")

    expect(duplicate).toBe(first)
    await Promise.all([first, duplicate, renamed])
    expect(teamHeaders).toEqual(["before", "after"])
    expect(getCachedTeamConnectionApps("account-1", "team-1", "before")).toMatchObject([
      { id: "app-before", service: "github" },
    ])
    expect(getCachedTeamConnectionApps("account-1", "team-1", "after")).toMatchObject([
      { id: "app-after", service: "github" },
    ])
  })

  it("notifies mounted member consumers when the resource is invalidated", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTeamMembersResource("account-1", "team-1", listener)

    invalidateTeamDetailsResource("account-1", "team-1")

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it("lets a forced refresh supersede an older in-flight read", async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    let resolveSecond: ((response: Response) => void) | undefined
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecond = resolve
          }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const first = getTeamMembersResource("account-1", "team-1")
    const refreshed = getTeamMembersResource("account-1", "team-1", { forceRefresh: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveSecond?.(Response.json({ members: [{ role: "member", user_id: "new-user" }] }))
    await expect(refreshed).resolves.toEqual([{ role: "member", user_id: "new-user" }])
    resolveFirst?.(Response.json({ members: [{ role: "member", user_id: "old-user" }] }))
    await expect(first).resolves.toEqual([{ role: "member", user_id: "old-user" }])

    expect(getCachedTeamMembers("account-1", "team-1")).toEqual([{ role: "member", user_id: "new-user" }])
  })
})

describe("incremental user summaries", () => {
  afterEach(() => {
    clearTeamDetailsResources()
    vi.unstubAllGlobals()
  })

  it("shares overlapping requests and refetches only missing users", async () => {
    const { getTeamUserSummariesResource } = await import("./team-details-resource.ts")
    let resolveFirst!: (response: Response) => void
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue(Response.json({ third: { username: "Third" } }))
    vi.stubGlobal("fetch", fetchMock)
    const first = getTeamUserSummariesResource("a", "t", ["first", "second"])
    const overlap = getTeamUserSummariesResource("a", "t", ["second", "third"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.getAll("user_ids")).toEqual(["third"])
    resolveFirst(Response.json({ first: { username: "First" }, second: { username: "Second" } }))
    expect(await first).toHaveProperty("first")
    expect(await overlap).toHaveProperty("second")
    expect(await overlap).toHaveProperty("third")
    await getTeamUserSummariesResource("a", "t", ["first", "third"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("keeps newer summaries after a superseded request finishes and isolates accounts", async () => {
    const { getTeamUserSummariesResource, getCachedTeamUserSummaries } = await import("./team-details-resource.ts")
    let resolveFirst!: (response: Response) => void
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementation(async () => Response.json({ user: { username: "New" } }))
    vi.stubGlobal("fetch", fetchMock)
    const first = getTeamUserSummariesResource("a", "t", ["user"])
    await getTeamUserSummariesResource("a", "t", ["user"], { forceRefresh: true })
    resolveFirst(Response.json({ user: { username: "Old" } }))
    await first
    expect(getCachedTeamUserSummaries("a", "t", ["user"])?.user.username).toBe("New")
    expect(getCachedTeamUserSummaries("b", "t", ["user"])).toBeNull()
    await getTeamUserSummariesResource("b", "t", ["user"])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries failed summaries and honors per-user expiry", async () => {
    const { getTeamUserSummariesResource } = await import("./team-details-resource.ts")
    const startedAt = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (input) => {
        const ids = new URL(String(input)).searchParams.getAll("user_ids")
        return Response.json(Object.fromEntries(ids.map((id) => [id, { username: id }])))
      })
    vi.stubGlobal("fetch", fetchMock)
    try {
      await expect(getTeamUserSummariesResource("a", "t", ["first"])).rejects.toThrow("offline")
      await getTeamUserSummariesResource("a", "t", ["first"])
      clock.mockReturnValue(startedAt + 30_000)
      await getTeamUserSummariesResource("a", "t", ["second"])
      clock.mockReturnValue(startedAt + 61_000)
      await getTeamUserSummariesResource("a", "t", ["first", "second"])
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(new URL(String(fetchMock.mock.calls[3]?.[0])).searchParams.getAll("user_ids")).toEqual(["first"])
    } finally {
      clock.mockRestore()
    }
  })

  it("does not resurrect invalidated summaries after a late response", async () => {
    const { getTeamUserSummariesResource, getCachedTeamUserSummaries } = await import("./team-details-resource.ts")
    let finish!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
    )
    const pending = getTeamUserSummariesResource("a", "t", ["user"])
    invalidateTeamDetailsResource("a", "t")
    finish(Response.json({ user: { username: "Late" } }))
    await pending
    expect(getCachedTeamUserSummaries("a", "t", ["user"])).toBeNull()
  })
})
