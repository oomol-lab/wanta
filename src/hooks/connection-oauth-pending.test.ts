import { describe, expect, it } from "vitest"
import {
  connectionWorkspaceKey,
  createConnectionPollingKey,
  createOAuthPendingKey,
  isConnectionPollingTarget,
} from "./connection-oauth-pending.ts"

describe("connection OAuth pending key", () => {
  it("deduplicates OAuth requests by workspace and service", () => {
    const workspace = { type: "personal" } as const

    expect(createOAuthPendingKey(workspace, { authType: "oauth2", service: "gmail" })).toBe(
      createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" }),
    )
  })

  it("separates services and organization workspaces", () => {
    const personalGmail = createOAuthPendingKey({ type: "personal" }, { authType: "oauth2", service: "gmail" })
    const personalSlack = createOAuthPendingKey({ type: "personal" }, { authType: "oauth2", service: "slack" })
    const organizationGmail = createOAuthPendingKey(
      { organizationName: "acme", type: "organization" },
      { authType: "oauth2", service: "gmail" },
    )

    expect(personalGmail).not.toBe(personalSlack)
    expect(personalGmail).not.toBe(organizationGmail)
  })

  it("shares workspace and polling key formatting helpers", () => {
    expect(connectionWorkspaceKey({ type: "personal" })).toBe("personal")
    expect(connectionWorkspaceKey({ organizationName: "acme", type: "organization" })).toBe("organization:acme")
    expect(createConnectionPollingKey("gmail")).toBe("gmail")
    expect(createConnectionPollingKey("gmail", "app-1")).toBe("gmail\0app-1")
    expect(isConnectionPollingTarget("gmail\0app-1", "gmail", "app-1")).toBe(true)
    expect(isConnectionPollingTarget("gmail\0app-1", "gmail", "app-2")).toBe(false)
  })
})
