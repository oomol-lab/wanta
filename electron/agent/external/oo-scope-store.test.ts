import { describe, expect, test } from "vitest"
import { ExternalOoScopeStore } from "./oo-scope-store.ts"

describe("ExternalOoScopeStore", () => {
  test("tracks only running external turns and their teams", async () => {
    const store = new ExternalOoScopeStore()

    await store.activate("session-a", "oomol", "Team A")
    await store.activate("session-b", "oomol", "Team A")
    expect(store.snapshot()).toEqual({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol", "session-b": "oomol" },
      sessionTeams: { "session-a": "Team A", "session-b": "Team A" },
    })

    await store.deactivate("session-a")
    expect(store.snapshot()).toMatchObject({
      sessionRuntimes: { "session-b": "oomol" },
      sessionTeams: { "session-b": "Team A" },
    })
  })

  test("retains each active turn's identity when the runtime changes", async () => {
    const store = new ExternalOoScopeStore()

    await store.activate("session-a", "oomol", "Team A")
    await store.setRuntime("openconnector")

    expect(store.snapshot()).toEqual({
      external: true,
      runtime: "openconnector",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })
  })
})
