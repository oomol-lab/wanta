import assert from "node:assert/strict"
import { describe, test } from "vitest"
import {
  bindOomolWorkspace,
  hasWorkspaceSelector,
  isConnectorBusinessCommand,
  redactConnectorOutput,
  resolveGuardWorkspaceTeam,
} from "./oo-guard-core.ts"

describe("OOMOL connector workspace guard", () => {
  test("binds bare connector business commands to the active team", () => {
    assert.deepEqual(bindOomolWorkspace(["connector", "apps", "posthog", "--json"], "OOMOL-Internal"), [
      "connector",
      "apps",
      "posthog",
      "--json",
      "--team",
      "OOMOL-Internal",
    ])
    assert.deepEqual(bindOomolWorkspace(["connector", "run", "posthog", "--action", "list_projects"], "team-a"), [
      "connector",
      "run",
      "posthog",
      "--action",
      "list_projects",
      "--team",
      "team-a",
    ])
  })

  test("preserves explicit selectors and identity-independent commands", () => {
    const explicit = ["connector", "run", "posthog", "--team", "team-a"]
    assert.deepEqual(bindOomolWorkspace(explicit, "team-b"), explicit)
    assert.deepEqual(bindOomolWorkspace(["connector", "schema", "posthog"], "team-a"), [
      "connector",
      "schema",
      "posthog",
    ])
    assert.equal(hasWorkspaceSelector(["connector", "apps", "--personal"]), true)
    assert.equal(isConnectorBusinessCommand(["connector", "search", "posthog"]), false)
  })

  test("fails closed when a business command has no usable team", () => {
    assert.throws(() => bindOomolWorkspace(["connector", "run", "posthog"], " "), /without an active team workspace/u)
  })

  test("prefers the sole active session workspace over a stale default", () => {
    assert.equal(
      resolveGuardWorkspaceTeam({ teamName: "old-team", sessionTeams: { "session-1": "new-team" } }),
      "new-team",
    )
    assert.equal(
      resolveGuardWorkspaceTeam({
        teamName: "old-team",
        sessionTeams: { "session-1": "new-team", "session-2": "new-team" },
      }),
      "new-team",
    )
  })

  test("fails closed instead of guessing between active session workspaces", () => {
    assert.throws(
      () =>
        resolveGuardWorkspaceTeam({
          teamName: "team-a",
          sessionTeams: { "session-1": "team-a", "session-2": "team-b" },
        }),
      /active sessions use different workspaces/u,
    )
    assert.throws(
      () => bindOomolWorkspace(["connector", "apps"], resolveGuardWorkspaceTeam({ sessionTeams: { local: "" } })),
      /without an active team workspace/u,
    )
  })
})

describe("connector output redaction", () => {
  test("recursively redacts credential fields while preserving business data", () => {
    const output = redactConnectorOutput(
      `${JSON.stringify({
        data: {
          api_token: "phc_public-looking-but-sensitive",
          id: 173107,
          nested: { accessToken: "access", secret_api_token: "private" },
          name: "CLI",
        },
      })}\n`,
    )
    assert.deepEqual(JSON.parse(output), {
      data: {
        api_token: "[redacted]",
        id: 173107,
        nested: { accessToken: "[redacted]", secret_api_token: "[redacted]" },
        name: "CLI",
      },
    })
  })

  test("redacts credential fields from non-JSON errors", () => {
    const output = redactConnectorOutput('request failed api_token="secret value", password=hunter2')
    assert.equal(output.includes("secret value"), false)
    assert.equal(output.includes("hunter2"), false)
    assert.match(output, /api_token=\[redacted\]/u)
    assert.match(output, /password=\[redacted\]/u)
  })
})
