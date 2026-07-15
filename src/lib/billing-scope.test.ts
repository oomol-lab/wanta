import { describe, expect, it } from "vitest"
import { billingRequestScopeForWorkspace } from "./billing-scope.ts"

describe("billingRequestScopeForWorkspace", () => {
  it("carries both organization identifiers", () => {
    const workspace = {
      canManage: true,
      organization: {
        avatar: "",
        creator_user_id: "user-1",
        id: "team-1",
        name: "acme",
        role: "creator" as const,
      },
      organizationId: "team-1",
      role: "creator" as const,
    }
    expect(billingRequestScopeForWorkspace(workspace)).toEqual({
      canManageBilling: true,
      organizationId: "team-1",
      organizationName: "acme",
    })
  })

  it("waits for organization metadata before enabling billing", () => {
    const workspace = {
      canManage: true,
      organization: null,
      organizationId: "team-1",
      role: "creator" as const,
    }
    expect(billingRequestScopeForWorkspace(workspace)).toBeNull()
  })
})
