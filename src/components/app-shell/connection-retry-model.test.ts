import { describe, expect, it } from "vitest"
import { connectionRetryTargetMatches } from "./connection-retry-model.ts"

describe("connectionRetryTargetMatches", () => {
  it("accepts a successful account mutation when the failed action used the default account", () => {
    expect(connectionRetryTargetMatches({ service: "github" }, { service: "github", connectionName: "work" })).toBe(
      true,
    )
  })

  it("requires the explicitly targeted account to match", () => {
    expect(
      connectionRetryTargetMatches(
        { service: "github", connectionName: "work" },
        { service: "github", connectionName: "personal" },
      ),
    ).toBe(false)
    expect(
      connectionRetryTargetMatches(
        { service: "github", connectionName: "work" },
        { service: "github", connectionName: "work" },
      ),
    ).toBe(true)
  })

  it("never completes a retry for another provider", () => {
    expect(connectionRetryTargetMatches({ service: "github" }, { service: "slack" })).toBe(false)
  })
})
