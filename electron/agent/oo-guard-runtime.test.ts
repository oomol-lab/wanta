import { execFile } from "node:child_process"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, test } from "vitest"

const execFileAsync = promisify(execFile)
const roots: string[] = []
const guardPath = path.resolve("electron/agent/oo-guard.ts")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function fixture(scope: unknown): Promise<{ env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-guard-runtime-"))
  roots.push(root)
  const realOo = path.join(root, "real-oo")
  const scopePath = path.join(root, "scope.json")
  await writeFile(realOo, '#!/bin/sh\nprintf "%s\\n" "$@"\n', "utf8")
  await chmod(realOo, 0o755)
  await writeFile(scopePath, JSON.stringify(scope), "utf8")
  return {
    env: {
      ...process.env,
      WANTA_EXTERNAL_OO_SCOPE: "1",
      WANTA_REAL_OO_BIN: realOo,
      WANTA_TEAM_SCOPE_PATH: scopePath,
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
      sessionTeams: { "session-a": "Team A", "session-b": "Team B" },
    })

    await expect(runGuard(["connector", "run", "posthog", "--action", "list_projects"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("running turns use different teams"),
    })
  })

  test("removes OOMOL selectors under OpenConnector", async () => {
    const { env } = await fixture({ external: true, runtime: "openconnector", sessionTeams: {} })

    const output = await runGuard(["connector", "apps", "posthog", "--team", "ignored", "--personal", "--json"], env)
    expect(output.trim().split("\n")).toEqual(["connector", "apps", "posthog", "--json"])
  })
})
