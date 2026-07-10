import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearOrganizationDetailsResources,
  getCachedOrganizationMembers,
  getOrganizationMembersResource,
  invalidateOrganizationDetailsResource,
} from "./organization-details-resource.ts"

describe("organization-details-resource", () => {
  afterEach(() => {
    clearOrganizationDetailsResources()
    vi.unstubAllGlobals()
  })

  it("deduplicates concurrent member reads for the same account and organization", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ members: [{ role: "creator", user_id: "user-1" }] }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([
      getOrganizationMembersResource("account-1", "org-1"),
      getOrganizationMembersResource("account-1", "org-1"),
    ])

    expect(first).toEqual([{ role: "creator", user_id: "user-1" }])
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getCachedOrganizationMembers("account-1", "org-1")).toEqual(first)
  })

  it("keeps account scopes isolated and refetches after targeted invalidation", async () => {
    let requestCount = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      requestCount += 1
      return Response.json({ members: [{ role: "member", user_id: `user-${requestCount}` }] })
    })
    vi.stubGlobal("fetch", fetchMock)

    await getOrganizationMembersResource("account-1", "org-1")
    await getOrganizationMembersResource("account-2", "org-1")
    invalidateOrganizationDetailsResource("account-1", "org-1")
    const refreshed = await getOrganizationMembersResource("account-1", "org-1")

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(refreshed).toEqual([{ role: "member", user_id: "user-3" }])
    expect(getCachedOrganizationMembers("account-2", "org-1")).toEqual([{ role: "member", user_id: "user-2" }])
  })
})
