import { describe, expect, it } from "vitest"
import { createOAuthPendingKey } from "./connection-oauth-pending.ts"

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
})
