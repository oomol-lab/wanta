import type { ConnectionAppSummary } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import {
  applyMemberConnectionAccessDelta,
  filterMemberConnectionAccessItems,
  MemberConnectionAccessError,
  projectMemberConnectionAccess,
  projectTeamMemberConnectionAccessSummaries,
} from "./team-member-connection-access-model.ts"

const github = app("app-github", "github", "Work GitHub")
const slack = app("app-slack", "slack", "Support Slack")

describe("projectTeamMemberConnectionAccessSummaries", () => {
  it("computes member summaries without materializing every member-App item", () => {
    const projected = projectTeamMemberConnectionAccessSummaries(
      {
        "role::connector-app:app-github": {
          connector: [{ method: "POST", provider: "github", requireRole: true }],
        },
        "user::alice": { roles: ["connector-app:app-github"] },
      },
      [github, slack],
      ["alice", "bob"],
    )

    expect(projected.ok).toBe(true)
    if (!projected.ok) return
    expect(projected.byUserId.get("alice")).toEqual({
      effectiveCount: 2,
      explicitCount: 1,
      invalidCount: 0,
      noneCount: 0,
      teamCount: 1,
      totalCount: 2,
    })
    expect(projected.byUserId.get("bob")).toEqual({
      effectiveCount: 1,
      explicitCount: 0,
      invalidCount: 0,
      noneCount: 1,
      teamCount: 1,
      totalCount: 2,
    })
  })
})

describe("projectMemberConnectionAccess", () => {
  it("distinguishes inherited, explicit, and unavailable Connections", () => {
    const projected = projectMemberConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [
            {
              actions: ["issues.list", "issues.create"],
              method: "POST",
              provider: "github",
              requireRole: true,
            },
          ],
        },
        "user::alice": { roles: ["connector-app:app-github"] },
      },
      [github, slack],
      "alice",
    )

    expect(projected).toMatchObject({
      ok: true,
      summary: { effectiveCount: 2, explicitCount: 1, invalidCount: 0, teamCount: 1, totalCount: 2 },
      items: [
        {
          actionCount: 2,
          actionScope: "selected",
          appId: "app-github",
          effective: true,
          provenance: "explicit",
        },
        {
          actionCount: null,
          actionScope: "all",
          appId: "app-slack",
          effective: true,
          provenance: "team",
        },
      ],
    })

    const bob = projectMemberConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [{ method: "POST", provider: "github", requireRole: true }],
        },
        "user::alice": { roles: ["connector-app:app-github"] },
      },
      [github, slack],
      "bob",
    )
    expect(bob).toMatchObject({
      ok: true,
      summary: { effectiveCount: 1, explicitCount: 0, teamCount: 1 },
      items: [
        { appId: "app-slack", provenance: "team" },
        { appId: "app-github", effective: false, provenance: "none" },
      ],
    })
  })

  it("fails closed and surfaces malformed or missing Apps", () => {
    const projected = projectMemberConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [{ method: "GET", provider: "github", requireRole: false }],
        },
        "user::alice": { roles: ["connector-app:app-missing"] },
      },
      [github],
      "alice",
    )

    expect(projected).toMatchObject({
      ok: true,
      summary: { effectiveCount: 0, invalidCount: 2, totalCount: 2 },
      items: [
        { appId: "app-missing", effective: false, provenance: "invalid" },
        { appId: "app-github", effective: false, provenance: "invalid" },
      ],
    })
  })

  it("keeps an empty Action allowlist independent from member access", () => {
    const projected = projectMemberConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [{ actions: [], method: "POST", provider: "github", requireRole: false }],
        },
      },
      [github],
      "alice",
    )

    expect(projected).toMatchObject({
      ok: true,
      items: [{ actionCount: 0, actionScope: "none", effective: true, provenance: "team" }],
    })
  })
})

describe("filterMemberConnectionAccessItems", () => {
  it("filters by provenance, label, service, and App ID", () => {
    const projected = projectMemberConnectionAccess({}, [github, slack], "alice")
    if (!projected.ok) throw new Error("Expected a valid projection")

    expect(filterMemberConnectionAccessItems(projected.items, "team", "support").map((item) => item.appId)).toEqual([
      "app-slack",
    ])
    expect(filterMemberConnectionAccessItems(projected.items, "all", "GITHUB").map((item) => item.appId)).toEqual([
      "app-github",
    ])
    expect(filterMemberConnectionAccessItems(projected.items, "none", "")).toEqual([])
  })
})

describe("applyMemberConnectionAccessDelta", () => {
  it("updates only explicit selected-member grants and preserves Action restrictions", () => {
    const access = {
      "role::connector-app:app-github": {
        connector: [
          {
            actions: ["issues.list"],
            method: "POST",
            provider: "github",
            requireRole: true,
          },
        ],
      },
      "role::connector-app:app-slack": {
        connector: [{ method: "POST", provider: "slack", requireRole: true }],
      },
      "user::alice": { roles: ["connector-app:app-github", "unrelated"] },
      "user::bob": { roles: ["connector-app:app-slack"] },
      "other::subject": { keep: true },
    }

    expect(
      applyMemberConnectionAccessDelta(access, [github, slack], {
        addAppIds: ["app-slack"],
        removeAppIds: ["app-github"],
        userId: "alice",
      }),
    ).toEqual({
      "role::connector-app:app-github": {
        connector: [
          {
            actions: ["issues.list"],
            app: ["app-github"],
            method: "POST",
            provider: "github",
            requireRole: true,
          },
        ],
      },
      "role::connector-app:app-slack": {
        connector: [{ app: ["app-slack"], method: "POST", provider: "slack", requireRole: true }],
      },
      "user::alice": { roles: ["connector-app:app-slack", "unrelated"] },
      "user::bob": { roles: ["connector-app:app-slack"] },
      "other::subject": { keep: true },
    })
  })

  it("rejects a per-member change to Team-inherited access", () => {
    expect(() => {
      try {
        applyMemberConnectionAccessDelta({}, [github], {
          addAppIds: [],
          removeAppIds: ["app-github"],
          userId: "alice",
        })
      } catch (error) {
        expect(error).toBeInstanceOf(MemberConnectionAccessError)
        expect(error).toMatchObject({ appId: "app-github", code: "teamInherited" })
        throw error
      }
    }).toThrow(MemberConnectionAccessError)
  })

  it("returns stable error codes for conflicting and unavailable Apps", () => {
    expect(() =>
      applyMemberConnectionAccessDelta({}, [github], {
        addAppIds: ["app-github"],
        removeAppIds: ["app-github"],
        userId: "alice",
      }),
    ).toThrow(expect.objectContaining({ code: "conflictingDelta" }))

    expect(() =>
      applyMemberConnectionAccessDelta({}, [github], {
        addAppIds: [],
        removeAppIds: ["missing-app"],
        userId: "alice",
      }),
    ).toThrow(expect.objectContaining({ appId: "missing-app", code: "unavailable" }))
  })

  it("returns a stable error code for a malformed Team policy", () => {
    expect(() =>
      applyMemberConnectionAccessDelta({ "user::alice": { roles: "connector-app:app-github" } } as never, [github], {
        addAppIds: [],
        removeAppIds: [],
        userId: "alice",
      }),
    ).toThrow(expect.objectContaining({ code: "invalidPolicy" }))
  })
})

function app(id: string, service: string, alias: string): ConnectionAppSummary {
  return {
    alias,
    authType: "oauth2",
    createdAt: 1,
    id,
    isDefault: false,
    service,
    status: "active",
    updatedAt: 1,
  }
}
