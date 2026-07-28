import { describe, expect, it } from "vitest"
import { formatUserIdentity } from "./account-copy.ts"

describe("formatUserIdentity", () => {
  it("formats the complete user identity for operational use", () => {
    expect(
      formatUserIdentity({
        id: "user-123",
        email: "shaun@example.com",
        name: "Shaun",
        username: "alwaysmavs",
      }),
    ).toBe("UID: user-123\nEmail: shaun@example.com\nUsername: alwaysmavs\nDisplay Name: Shaun")
  })

  it("omits unavailable optional fields", () => {
    expect(formatUserIdentity({ id: "user-123", name: "Shaun" })).toBe("UID: user-123\nDisplay Name: Shaun")
  })
})
