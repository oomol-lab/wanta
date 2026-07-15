import { describe, expect, it } from "vitest"
import {
  applyOrganizationPatchesToOverview,
  resolveOrganizationSelection,
  upsertOverviewOrganization,
} from "./organization-overview.ts"

describe("organization overview patching", () => {
  it("updates existing organizations while preserving local role metadata", () => {
    const overview = {
      accountId: "user-1",
      created: [
        {
          avatar: "old.png",
          creator_user_id: "user-1",
          id: "org-1",
          name: "old",
          role: "creator" as const,
          writable: true,
        },
      ],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewOrganization(overview, {
      avatar: "new.png",
      creator_user_id: "user-1",
      id: "org-1",
      name: "new",
    })

    expect(next?.created[0]).toMatchObject({
      avatar: "new.png",
      id: "org-1",
      name: "new",
      role: "creator",
      writable: true,
    })
  })

  it("adds new creator organizations to the created list", () => {
    const overview = {
      accountId: "user-1",
      created: [],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewOrganization(overview, {
      avatar: "",
      creator_user_id: "user-1",
      id: "org-1",
      name: "acme",
    })

    expect(next?.created).toHaveLength(1)
    expect(next?.joined).toHaveLength(0)
    expect(next?.created[0]?.name).toBe("acme")
  })

  it("does not add unrelated optimistic patches to another account overview", () => {
    const overview = {
      accountId: "user-2",
      created: [],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = upsertOverviewOrganization(overview, {
      avatar: "",
      creator_user_id: "user-1",
      id: "org-1",
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
          id: "org-1",
          name: "old",
        },
      ],
      joined: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const next = applyOrganizationPatchesToOverview(staleOverview, [
      {
        avatar: "new.png",
        creator_user_id: "user-1",
        id: "org-1",
        name: "new",
      },
    ])

    expect(next.created[0]).toMatchObject({ avatar: "new.png", name: "new" })
  })
})

describe("organization workspace selection", () => {
  const organizations = [
    { avatar: "", creator_user_id: "user-1", id: "first", name: "First" },
    { avatar: "", creator_user_id: "user-2", id: "second", name: "Second" },
  ]

  it("keeps an existing organization selection", () => {
    expect(resolveOrganizationSelection("second", organizations)).toBe("second")
  })

  it("falls back to the first organization when no organization is selected", () => {
    expect(resolveOrganizationSelection(null, organizations)).toBe("first")
  })

  it("falls back to the first organization when the stored organization is unavailable", () => {
    expect(resolveOrganizationSelection("missing", organizations)).toBe("first")
  })

  it("keeps the personal fallback when no organizations are available", () => {
    expect(resolveOrganizationSelection(null, [])).toBeNull()
  })
})
