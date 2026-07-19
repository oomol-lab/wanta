import { describe, expect, it } from "vitest"
import { connectionRetryTargetMatches, discardConnectionRetriesForSession } from "./connection-retry-model.ts"

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

describe("discardConnectionRetriesForSession", () => {
  it("removes every pending retry for a discarded session and leaves other sessions intact", () => {
    const retries = new Map([
      ["drawer-a", { sessionId: "session-a", service: "github" }],
      ["drawer-a-second", { sessionId: "session-a", service: "slack" }],
      ["drawer-b", { sessionId: "session-b", service: "github" }],
    ])

    expect(discardConnectionRetriesForSession(retries, "session-a")).toEqual(["drawer-a", "drawer-a-second"])
    expect([...retries.keys()]).toEqual(["drawer-b"])
  })
})
