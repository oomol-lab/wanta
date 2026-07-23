import type { TeamMember, TeamRole } from "../../electron/teams/common.ts"

import { describe, expect, it } from "vitest"
import { canChangeTeamMemberRole } from "./team-permissions.ts"

function canChange({
  actorCanManage = true,
  actorRole,
  actorUserId = "actor",
  memberRole,
  memberUserId = "target",
}: {
  actorCanManage?: boolean
  actorRole: TeamRole | null
  actorUserId?: string
  memberRole: TeamRole
  memberUserId?: string
}): boolean {
  const member: TeamMember = { role: memberRole, user_id: memberUserId }
  return canChangeTeamMemberRole({ actorCanManage, actorRole, actorUserId, member })
}

describe("team member role permissions", () => {
  it("allows creators to update any non-creator role", () => {
    expect(canChange({ actorRole: "creator", memberRole: "member" })).toBe(true)
    expect(canChange({ actorRole: "creator", memberRole: "admin" })).toBe(true)
  })

  it("allows admins to update other non-creator members", () => {
    expect(canChange({ actorRole: "admin", memberRole: "member" })).toBe(true)
    expect(canChange({ actorRole: "admin", memberRole: "admin" })).toBe(true)
  })

  it("prevents admins from changing their own role", () => {
    expect(
      canChange({
        actorRole: "admin",
        actorUserId: "admin-1",
        memberRole: "admin",
        memberUserId: "admin-1",
      }),
    ).toBe(false)
  })

  it("protects creators and rejects non-manager actors", () => {
    expect(canChange({ actorRole: "creator", memberRole: "creator" })).toBe(false)
    expect(canChange({ actorRole: "admin", memberRole: "creator" })).toBe(false)
    expect(canChange({ actorRole: "member", memberRole: "member" })).toBe(false)
    expect(canChange({ actorRole: null, memberRole: "member" })).toBe(false)
  })

  it("fails closed without writable access or a known admin identity", () => {
    expect(canChange({ actorCanManage: false, actorRole: "creator", memberRole: "member" })).toBe(false)
    expect(canChange({ actorCanManage: false, actorRole: "admin", memberRole: "member" })).toBe(false)
    expect(canChange({ actorRole: "admin", actorUserId: "", memberRole: "member" })).toBe(false)
  })
})
