import { describe, expect, it } from "vitest"
import {
  applyTeamPatchesToOverview,
  mergeWorkspaceTeams,
  resolveTeamSelection,
  upsertOverviewTeam,
} from "./team-overview.ts"

describe("team overview patching", () => {
  it("updates existing teams while preserving local role metadata", () => {
    const overview = {
      accountId: "user-1",
      created: [
        {
          avatar: "old.png",
          creator_user_id: "user-1",
          id: "team-1",
          name: "old",
          role: "creator" as const,
          writable: true,
        },
      ],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewTeam(overview, {
      avatar: "new.png",
      creator_user_id: "user-1",
      id: "team-1",
      name: "new",
    })

    expect(next?.created[0]).toMatchObject({
      avatar: "new.png",
      id: "team-1",
      name: "new",
      role: "creator",
      writable: true,
    })
  })

  it("adds new creator teams to the created list", () => {
    const overview = {
      accountId: "user-1",
      created: [],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewTeam(overview, {
      avatar: "",
      creator_user_id: "user-1",
      id: "team-1",
      name: "acme",
    })

    expect(next?.created).toHaveLength(1)
    expect(next?.joined).toHaveLength(0)
    expect(next?.created[0]?.name).toBe("acme")
  })

  it("honors an explicit member role before the creator id fallback", () => {
    const overview = {
      accountId: "user-1",
      created: [],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewTeam(overview, {
      avatar: "",
      creator_user_id: "user-1",
      id: "team-1",
      name: "acme",
      role: "member",
    })

    expect(next?.created).toHaveLength(0)
    expect(next?.joined).toHaveLength(1)
  })

  it("adds explicit admin teams to the joined list", () => {
    const overview = {
      accountId: "user-1",
      created: [],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewTeam(overview, {
      avatar: "",
      creator_user_id: "creator-1",
      id: "team-1",
      name: "acme",
      role: "admin",
    })

    expect(next?.created).toHaveLength(0)
    expect(next?.joined).toEqual([expect.objectContaining({ id: "team-1", role: "admin" })])
  })

  it("does not add unrelated optimistic patches to another account overview", () => {
    const overview = {
      accountId: "user-2",
      created: [],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewTeam(overview, {
      avatar: "",
      creator_user_id: "user-1",
      id: "team-1",
      name: "acme",
    })

    expect(next).toBe(overview)
  })

  it("keeps optimistic patches over stale fetched overviews", () => {
    const staleOverview = {
      accountId: "user-1",
      created: [
        {
          avatar: "old.png",
          creator_user_id: "user-1",
          id: "team-1",
          name: "old",
        },
      ],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = applyTeamPatchesToOverview(staleOverview, [
      {
        avatar: "new.png",
        creator_user_id: "user-1",
        id: "team-1",
        name: "new",
      },
    ])

    expect(next.created[0]).toMatchObject({ avatar: "new.png", name: "new" })
  })

  it("merges duplicate workspace teams and preserves metadata from both lists", () => {
    const teams = mergeWorkspaceTeams({
      accountId: "user-1",
      created: [
        {
          avatar: "",
          creator_user_id: "user-1",
          id: "team-1",
          name: "Acme",
          system_created: true,
        },
      ],
      joined: [
        {
          avatar: "updated.png",
          creator_user_id: "user-1",
          id: "team-1",
          name: "Acme",
          role: "creator",
          writable: true,
        },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    })

    expect(teams).toEqual([
      expect.objectContaining({
        avatar: "updated.png",
        id: "team-1",
        role: "creator",
        system_created: true,
        writable: true,
      }),
    ])
  })

  it("places the system-created workspace first without changing other team order", () => {
    const teams = mergeWorkspaceTeams({
      accountId: "user-1",
      created: [
        { avatar: "", creator_user_id: "user-1", id: "first", name: "First" },
        { avatar: "", creator_user_id: "user-1", id: "system", name: "System", system_created: true },
        { avatar: "", creator_user_id: "user-1", id: "third", name: "Third" },
      ],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    })

    expect(teams.map((team) => team.id)).toEqual(["system", "first", "third"])
  })
})

describe("team workspace selection", () => {
  const teams = [
    { avatar: "", creator_user_id: "user-1", id: "first", name: "First" },
    { avatar: "", creator_user_id: "user-2", id: "second", name: "Second" },
  ]

  it("keeps an existing team selection", () => {
    expect(resolveTeamSelection("second", teams)).toBe("second")
  })

  it("falls back to the system-created team when no team is selected", () => {
    expect(resolveTeamSelection(null, [...teams, { ...teams[1], id: "system", system_created: true }])).toBe("system")
  })

  it("falls back to the system-created team when the stored team is unavailable", () => {
    expect(resolveTeamSelection("missing", [...teams, { ...teams[1], id: "system", system_created: true }])).toBe(
      "system",
    )
  })

  it("falls back to the first team when no system-created team is available", () => {
    expect(resolveTeamSelection(null, teams)).toBe("first")
  })

  it("keeps the empty result when no teams are available", () => {
    expect(resolveTeamSelection(null, [])).toBeNull()
  })
})
