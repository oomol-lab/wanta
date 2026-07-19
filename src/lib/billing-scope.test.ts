import { describe, expect, it } from "vitest"
import { billingRequestScopeForWorkspace } from "./billing-scope.ts"

describe("billingRequestScopeForWorkspace", () => {
  it("maps the workspace team to the billing team", () => {
    const workspace = {
      canManage: true,
      team: {
        avatar: "",
        creator_user_id: "user-1",
        id: "team-1",
        name: "acme",
        role: "creator" as const,
      },
      teamId: "team-1",
      role: "creator" as const,
    }
    expect(billingRequestScopeForWorkspace(workspace)).toEqual({
      canManageBilling: true,
      canManageFunding: true,
      teamId: "team-1",
      teamName: "acme",
    })
  })

  it("keeps writable members away from the creator's personal funding account", () => {
    const workspace = {
      canManage: true,
      team: {
        avatar: "",
        creator_user_id: "user-1",
        id: "team-1",
        name: "acme",
        role: "member" as const,
      },
      teamId: "team-1",
      role: "member" as const,
    }

    expect(billingRequestScopeForWorkspace(workspace)).toMatchObject({
      canManageBilling: true,
      canManageFunding: false,
    })
  })

  it("waits for team metadata before enabling billing", () => {
    const workspace = {
      canManage: true,
      team: null,
      teamId: "team-1",
      role: "creator" as const,
    }
    expect(billingRequestScopeForWorkspace(workspace)).toBeNull()
  })
})
