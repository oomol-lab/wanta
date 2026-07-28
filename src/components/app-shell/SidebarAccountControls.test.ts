import { describe, expect, it } from "vitest"
import { formatUserIdentity } from "./account-copy.ts"

describe("formatUserIdentity", () => {
  it.each([
    {
      expectedComplete: "User ID: user-123\nEmail: shaun@example.com\nUsername: alwaysmavs\nDisplay name: Shaun",
      expectedMinimal: "User ID: user-123\nDisplay name: Shaun",
      labels: {
        displayName: "Display name",
        email: "Email",
        uid: "User ID",
        username: "Username",
      },
      locale: "English",
    },
    {
      expectedComplete: "用户 ID: user-123\n邮箱: shaun@example.com\n用户名: alwaysmavs\n显示名称: Shaun",
      expectedMinimal: "用户 ID: user-123\n显示名称: Shaun",
      labels: {
        displayName: "显示名称",
        email: "邮箱",
        uid: "用户 ID",
        username: "用户名",
      },
      locale: "Chinese",
    },
  ])("formats the user identity with $locale labels", ({ expectedComplete, expectedMinimal, labels }) => {
    expect(
      formatUserIdentity(
        {
          id: "user-123",
          email: "shaun@example.com",
          name: "Shaun",
          username: "alwaysmavs",
        },
        labels,
      ),
    ).toBe(expectedComplete)

    expect(
      formatUserIdentity(
        {
          id: "user-123",
          name: "Shaun",
        },
        labels,
      ),
    ).toBe(expectedMinimal)
  })
})
