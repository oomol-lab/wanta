import { describe, expect, it } from "vitest"
import { billingRequestScopeForWorkspace, canManageWantaBilling } from "./billing-scope.ts"

describe("billingRequestScopeForWorkspace", () => {
  it("keeps personal billing unscoped", () => {
    expect(billingRequestScopeForWorkspace({ type: "personal" })).toEqual({ type: "personal" })
    expect(canManageWantaBilling({ type: "personal" })).toBe(false)
  })

  it("carries both organization identifiers and billing permission", () => {
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
      type: "organization" as const,
    }
    expect(billingRequestScopeForWorkspace(workspace)).toEqual({
      canManageBilling: true,
      organizationId: "team-1",
      organizationName: "acme",
      type: "organization",
    })
    expect(canManageWantaBilling(workspace)).toBe(true)
  })

  it("keeps organization members out of Wanta plan management", () => {
    const workspace = {
      canManage: false,
      organization: {
        avatar: "",
        creator_user_id: "user-1",
        id: "team-1",
        name: "acme",
        role: "member" as const,
      },
      organizationId: "team-1",
      role: "member" as const,
      type: "organization" as const,
    }
    expect(canManageWantaBilling(workspace)).toBe(false)
    expect(billingRequestScopeForWorkspace(workspace)).toEqual({
      canManageBilling: false,
      organizationId: "team-1",
      organizationName: "acme",
      type: "organization",
    })
  })

  it("waits for organization metadata before enabling billing", () => {
    const workspace = {
      canManage: true,
      organization: null,
      organizationId: "team-1",
      role: "creator" as const,
      type: "organization" as const,
    }
    expect(canManageWantaBilling(workspace)).toBe(false)
    expect(billingRequestScopeForWorkspace(workspace)).toBeNull()
  })
})
