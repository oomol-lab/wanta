import { describe, expect, test } from "vitest"
import { externalSessionScratchCwd, ExternalOoScopeStore } from "./oo-scope-store.ts"

test("derives the ACP default cwd for every registered external agent", () => {
  for (const [kind, uuid] of [
    ["claude-code", "fe98156f-05b8-42f4-8ee0-b68a8249b762"],
    ["codex", "63f2e135-0fd7-453c-8024-e9220e11daac"],
    ["grok", "8f812183-8f17-4b00-8fe9-55459ef45c69"],
  ] as const) {
    expect(externalSessionScratchCwd("/wanta/agent-external", `wanta-ext:${kind}:${uuid}`)).toBe(
      `/wanta/agent-external/${kind}/${uuid}`,
    )
  }
  expect(externalSessionScratchCwd("/wanta/agent-external", "session-local")).toBeUndefined()
})

describe("ExternalOoScopeStore", () => {
  test("tracks only running external turns and their teams", async () => {
    const store = new ExternalOoScopeStore()

    await store.activate("session-a", "oomol", "Team A", ["/managed/a", "/managed/a"])
    await store.activate("session-b", "oomol", "Team A", ["/managed/b"])
    expect(store.snapshot()).toEqual({
      external: true,
      runtime: "oomol",
      sessionCwdRoots: { "session-a": ["/managed/a"], "session-b": ["/managed/b"] },
      sessionRuntimes: { "session-a": "oomol", "session-b": "oomol" },
      sessionTeams: { "session-a": "Team A", "session-b": "Team A" },
    })

    await store.deactivate("session-a")
    expect(store.snapshot()).toMatchObject({
      sessionCwdRoots: { "session-b": ["/managed/b"] },
      sessionRuntimes: { "session-b": "oomol" },
      sessionTeams: { "session-b": "Team A" },
    })
  })

  test("retains each active turn's identity when the runtime changes", async () => {
    const store = new ExternalOoScopeStore()

    await store.activate("session-a", "oomol", "Team A", ["/managed/a"])
    await store.setRuntime("openconnector")

    expect(store.snapshot()).toEqual({
      external: true,
      runtime: "openconnector",
      sessionCwdRoots: { "session-a": ["/managed/a"] },
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })
  })
})
