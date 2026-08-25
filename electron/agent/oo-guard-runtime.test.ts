import type { WorkspaceTeamScope } from "./oo-guard-core.ts"

import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ExternalOoGuardServer } from "./external/oo-guard-server.ts"

const execFileAsync = promisify(execFile)
const roots: string[] = []
const servers: ExternalOoGuardServer[] = []
const guardPath = path.resolve("electron/agent/oo-guard.ts")

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function fixture(
  scope: unknown,
  commandBody = '#!/bin/sh\nprintf "%s\\n" "$@"\n',
): Promise<{ env: NodeJS.ProcessEnv; server: ExternalOoGuardServer }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-guard-runtime-"))
  roots.push(root)
  const realOo = path.join(root, "real-oo")
  await writeFile(realOo, commandBody, "utf8")
  await chmod(realOo, 0o755)
  const server = new ExternalOoGuardServer({ command: realOo, scope: () => scope as WorkspaceTeamScope })
  servers.push(server)
  const descriptor = await server.descriptor()
  return {
    server,
    env: {
      ...process.env,
      WANTA_OO_GUARD_TOKEN: descriptor.token,
      WANTA_OO_GUARD_URL: descriptor.url,
    },
  }
}

async function runGuard(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", guardPath, ...args], {
    encoding: "utf8",
    env,
  })
  return result.stdout
}

describe("external OO guard runtime", () => {
  test("overrides a model-provided selector with the sole running OOMOL team", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "OOMOL-Internal" },
    })

    const output = await runGuard(
      ["connector", "run", "posthog", "--team", "wrong-team", "--action", "list_projects"],
      env,
    )
    expect(output.trim().split("\n")).toEqual([
      "connector",
      "run",
      "posthog",
      "--action",
      "list_projects",
      "--team",
      "OOMOL-Internal",
    ])
  })

  test("fails before the real CLI when running turns use different teams", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol", "session-b": "oomol" },
      sessionTeams: { "session-a": "Team A", "session-b": "Team B" },
    })

    await expect(runGuard(["connector", "run", "posthog", "--action", "list_projects"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("running turns use different teams"),
    })
  })

  test("removes OOMOL selectors under OpenConnector", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "openconnector",
      sessionRuntimes: { "session-a": "openconnector" },
      sessionTeams: { "session-a": "" },
    })

    const output = await runGuard(["connector", "apps", "posthog", "--team", "ignored", "--personal", "--json"], env)
    expect(output.trim().split("\n")).toEqual(["connector", "apps", "posthog", "--json"])
  })

  test("rejects runtime-administration commands at the privileged boundary", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })

    await expect(runGuard(["logout"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("Only managed connector discovery and action commands are allowed"),
    })
  })

  test("terminates an active OO command when the guard is disposed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-guard-cancel-"))
    roots.push(root)
    const startedPath = path.join(root, "started")
    const terminatedPath = path.join(root, "terminated")
    const { env, server } = await fixture(
      {
        external: true,
        runtime: "oomol",
        sessionRuntimes: { "session-a": "oomol" },
        sessionTeams: { "session-a": "Team A" },
      },
      `#!/bin/sh\nprintf started > "${startedPath}"\ntrap 'printf terminated > "${terminatedPath}"; exit 0' TERM\nwhile :; do :; done\n`,
    )

    const running = runGuard(["connector", "apps", "posthog"], env)
    await vi.waitFor(async () => expect(await readFile(startedPath, "utf8")).toBe("started"))
    await server.dispose()

    await expect(running).rejects.toBeDefined()
    await vi.waitFor(async () => expect(await readFile(terminatedPath, "utf8")).toBe("terminated"))
  })
})
