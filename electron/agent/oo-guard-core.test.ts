import assert from "node:assert/strict"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, test } from "vitest"
import {
  bindOomolWorkspace,
  bindExternalConnectorWorkspace,
  hasWorkspaceSelector,
  isConnectorBusinessCommand,
  isManagedExternalOoCommand,
  redactConnectorOutput,
  externalGuardSessionScope,
  resolveExternalGuardCwd,
  resolveExternalGuardCwdBinding,
  resolveGuardWorkspaceTeam,
  resolveExternalGuardWorkspaceTeam,
  stripIdentityIndependentWorkspaceSelectors,
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
    assert.equal(isManagedExternalOoCommand(["search", "analyze PostHog usage", "--json"]), true)
    assert.equal(isManagedExternalOoCommand(["--lang=en", "search", "generate an image", "--json"]), true)
    assert.equal(isManagedExternalOoCommand(["connector", "search", "posthog"]), true)
    assert.equal(isManagedExternalOoCommand(["connector", "run", "posthog"]), true)
    assert.equal(isManagedExternalOoCommand(["file", "download", "https://example.com/file"]), true)
    assert.equal(isManagedExternalOoCommand(["flow", "inspect", "demo", "--project", "project-a"]), true)
    assert.equal(isManagedExternalOoCommand(["flow", "delete", "demo", "--yes"]), false)
    assert.equal(isManagedExternalOoCommand(["skills", "recommend", "plan", "posthog"]), false)
    assert.equal(isManagedExternalOoCommand(["logout"]), false)
  })

  test("removes model-added workspace selectors from schema and search", () => {
    assert.deepEqual(
      stripIdentityIndependentWorkspaceSelectors([
        "connector",
        "schema",
        "posthog",
        "--action",
        "run_query",
        "--team",
        "OOMOL-Internal",
      ]),
      ["connector", "schema", "posthog", "--action", "run_query"],
    )
    assert.deepEqual(
      stripIdentityIndependentWorkspaceSelectors([
        "--lang=zh",
        "connector",
        "search",
        "posthog query",
        "--personal",
        "--organization=ignored",
      ]),
      ["--lang=zh", "connector", "search", "posthog query"],
    )
    assert.deepEqual(
      stripIdentityIndependentWorkspaceSelectors([
        "connector",
        "schema",
        "posthog",
        "--team=ignored",
        "--",
        "--team",
        "payload-value",
      ]),
      ["connector", "schema", "posthog", "--", "--team", "payload-value"],
    )
    assert.deepEqual(
      stripIdentityIndependentWorkspaceSelectors(["connector", "schema", "posthog", "--team", "--action", "run_query"]),
      ["connector", "schema", "posthog", "--action", "run_query"],
    )
    assert.deepEqual(stripIdentityIndependentWorkspaceSelectors(["connector", "schema", "posthog", "--org"]), [
      "connector",
      "schema",
      "posthog",
    ])
    assert.deepEqual(
      stripIdentityIndependentWorkspaceSelectors([
        "connector",
        "schema",
        "posthog",
        "--team",
        "--",
        "--team",
        "payload-value",
      ]),
      ["connector", "schema", "posthog", "--", "--team", "payload-value"],
    )
    assert.deepEqual(stripIdentityIndependentWorkspaceSelectors(["connector", "run", "posthog", "--team", "team-a"]), [
      "connector",
      "run",
      "posthog",
      "--team",
      "team-a",
    ])
  })

  test("parses documented global options and inserts selectors before the argument terminator", () => {
    const args = ["--lang", "zh", "--debug", "connector", "run", "posthog", "--", "--team", "payload"]
    assert.equal(isConnectorBusinessCommand(args), true)
    assert.equal(hasWorkspaceSelector(args), false)
    assert.deepEqual(bindOomolWorkspace(args, "team-a"), [
      "--lang",
      "zh",
      "--debug",
      "connector",
      "run",
      "posthog",
      "--team",
      "team-a",
      "--",
      "--team",
      "payload",
    ])
    assert.equal(hasWorkspaceSelector(["--lang=en", "connector", "apps", "--team=team-a"]), true)
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
        teamName: "workspace-default",
        sessionTeams: { local: "", "session-1": "new-team" },
      }),
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

  test("binds external OOMOL commands from the running-turn scope", () => {
    const scope = {
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    }
    assert.equal(resolveExternalGuardWorkspaceTeam(scope), "Team A")
    assert.deepEqual(bindExternalConnectorWorkspace(["connector", "apps", "posthog", "--json"], scope), [
      "connector",
      "apps",
      "posthog",
      "--json",
      "--team",
      "Team A",
    ])
    assert.deepEqual(
      bindExternalConnectorWorkspace(
        ["connector", "run", "posthog", "--team", "Wrong Team", "--action", "list_projects"],
        scope,
      ),
      ["connector", "run", "posthog", "--action", "list_projects", "--team", "Team A"],
    )
  })

  test("fails closed when concurrent external turns do not share one team", () => {
    assert.throws(
      () =>
        bindExternalConnectorWorkspace(["connector", "run", "posthog"], {
          external: true,
          runtime: "oomol",
          sessionRuntimes: { "session-a": "oomol", "session-b": "oomol" },
          sessionTeams: { "session-a": "Team A", "session-b": "Team B" },
        }),
      /running turns use different teams/u,
    )
    assert.throws(
      () =>
        bindExternalConnectorWorkspace(["connector", "run", "posthog"], {
          external: true,
          runtime: "oomol",
          sessionRuntimes: { "session-a": "oomol" },
          sessionTeams: { "session-a": "" },
        }),
      /without a running team-scoped turn/u,
    )
  })

  test("binds a canonical cwd to exactly one active session and rejects symlink escapes", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-guard-core-"))
    try {
      const sessionRoot = path.join(temporaryRoot, "session-a")
      const otherSessionRoot = path.join(temporaryRoot, "session-b")
      const queryDirectory = path.join(sessionRoot, "queries")
      const outsideRoot = path.join(temporaryRoot, "outside")
      await Promise.all([
        mkdir(queryDirectory, { recursive: true }),
        mkdir(otherSessionRoot, { recursive: true }),
        mkdir(outsideRoot, { recursive: true }),
      ])
      await symlink(outsideRoot, path.join(sessionRoot, "escape"))
      const scope = {
        runtime: "oomol",
        sessionCwdRoots: { "session-a": [sessionRoot], "session-b": [otherSessionRoot] },
        sessionRuntimes: { "session-a": "oomol", "session-b": "oomol" },
        sessionTeams: { "session-a": "Team A", "session-b": "Team B" },
      }

      const binding = resolveExternalGuardCwdBinding(scope, queryDirectory)
      assert.deepEqual(binding, { cwd: await realpath(queryDirectory), sessionId: "session-a" })
      assert.equal(resolveExternalGuardCwd(scope, queryDirectory), await realpath(queryDirectory))
      assert.deepEqual(externalGuardSessionScope(scope, binding.sessionId).sessionTeams, { "session-a": "Team A" })
      assert.throws(
        () => resolveExternalGuardCwd(scope, path.join(sessionRoot, "escape")),
        /outside the active turn's managed working directories/u,
      )
      assert.throws(() => resolveExternalGuardCwd(scope, "relative"), /without an absolute managed working directory/u)
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true })
    }
  })

  test("keeps OpenConnector business calls free of OOMOL selectors", () => {
    assert.deepEqual(
      bindExternalConnectorWorkspace(
        ["connector", "run", "posthog", "--team", "ignored", "--personal", "--action", "list_projects"],
        {
          external: true,
          runtime: "openconnector",
          sessionRuntimes: { "session-a": "openconnector" },
          sessionTeams: { "session-a": "" },
        },
      ),
      ["connector", "run", "posthog", "--action", "list_projects"],
    )
    assert.deepEqual(
      bindExternalConnectorWorkspace(["connector", "schema", "posthog", "--action", "list_projects"], {
        external: true,
        runtime: "none",
        sessionTeams: {},
      }),
      ["connector", "schema", "posthog", "--action", "list_projects"],
    )
  })

  test("fails closed when an active turn predates a Link runtime change", () => {
    assert.throws(
      () =>
        bindExternalConnectorWorkspace(["connector", "run", "posthog"], {
          external: true,
          runtime: "openconnector",
          sessionRuntimes: { "session-a": "oomol" },
          sessionTeams: { "session-a": "Team A" },
        }),
      /across a Link runtime change/u,
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
          nested: {
            accessToken: "access",
            APIKey: "uppercase-acronym",
            posthog_api_key: "vendor-prefixed",
            secret_api_token: "private",
            "x-api-key": "header-style",
          },
          name: "CLI",
        },
      })}\n`,
    )
    assert.deepEqual(JSON.parse(output), {
      data: {
        api_token: "[redacted]",
        id: 173107,
        nested: {
          accessToken: "[redacted]",
          APIKey: "[redacted]",
          posthog_api_key: "[redacted]",
          secret_api_token: "[redacted]",
          "x-api-key": "[redacted]",
        },
        name: "CLI",
      },
    })
  })

  test("redacts credential fields from non-JSON errors", () => {
    const output = redactConnectorOutput(
      'request failed api_token="secret value", password=hunter2 posthog_api_key=phc_secret x-api-key=header-secret',
    )
    assert.equal(output.includes("secret value"), false)
    assert.equal(output.includes("hunter2"), false)
    assert.match(output, /api_token=\[redacted\]/u)
    assert.match(output, /password=\[redacted\]/u)
    assert.match(output, /posthog_api_key=\[redacted\]/u)
    assert.match(output, /x-api-key=\[redacted\]/u)
  })

  test("redacts signed transfer URLs from transcripts but can preserve them for the live upload result", () => {
    const output = `${JSON.stringify({ downloadUrl: "https://signed.example.test/file?token=secret", fileName: "a.txt" })}\n`
    assert.deepEqual(JSON.parse(redactConnectorOutput(output)), {
      downloadUrl: "[redacted]",
      fileName: "a.txt",
    })
    assert.deepEqual(JSON.parse(redactConnectorOutput(output, new Set(["download_url"]))), {
      downloadUrl: "https://signed.example.test/file?token=secret",
      fileName: "a.txt",
    })
  })

  test("leaves output without credentials byte-for-byte unchanged", () => {
    const output = `{\n  "data": {\n    "id": 173107,\n    "name": "CLI"\n  }\n}\n`
    assert.equal(redactConnectorOutput(output), output)
  })
})
