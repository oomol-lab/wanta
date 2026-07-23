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
      canManageFunding: true,
      canManageTeamSubscription: true,
      canReadTeamSubscription: true,
      teamId: "team-1",
      teamName: "acme",
    })
  })

  it("lets admins read team subscriptions without funding or changing them", () => {
    const workspace = {
      canManage: true,
      team: {
        avatar: "",
        creator_user_id: "user-1",
        id: "team-1",
        name: "acme",
        role: "admin" as const,
      },
      teamId: "team-1",
      role: "admin" as const,
    }

    expect(billingRequestScopeForWorkspace(workspace)).toMatchObject({
      canManageFunding: false,
      canManageTeamSubscription: false,
      canReadTeamSubscription: true,
    })
  })

  it("keeps writable members away from creator-only billing details and mutations", () => {
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
      canManageFunding: false,
      canManageTeamSubscription: false,
      canReadTeamSubscription: false,
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
