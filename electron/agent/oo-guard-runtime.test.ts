import type { WorkspaceTeamScope } from "./oo-guard-core.ts"

import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
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
  available?: () => boolean | Promise<boolean>,
): Promise<{ env: NodeJS.ProcessEnv; root: string; server: ExternalOoGuardServer }> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-guard-runtime-"))
  roots.push(temporaryRoot)
  // macOS commonly spells the same temporary directory as /var and /private/var.
  // Use the physical spelling for both the caller cwd and the registered root.
  const root = await realpath(temporaryRoot)
  const realOo = path.join(root, "real-oo")
  await writeFile(realOo, commandBody, "utf8")
  await chmod(realOo, 0o755)
  const normalizedScope = {
    ...(scope as WorkspaceTeamScope),
    sessionCwdRoots:
      (scope as WorkspaceTeamScope).sessionCwdRoots ??
      Object.fromEntries(
        Object.keys(((scope as WorkspaceTeamScope).sessionRuntimes ?? {}) as Record<string, unknown>).map(
          (sessionId) => [sessionId, [root]],
        ),
      ),
  }
  const server = new ExternalOoGuardServer({ available, command: realOo, scope: () => normalizedScope })
  servers.push(server)
  const descriptor = await server.descriptor()
  return {
    server,
    env: {
      ...process.env,
      WANTA_OO_GUARD_TOKEN: descriptor.token,
      WANTA_OO_GUARD_URL: descriptor.url,
      WANTA_TEST_GUARD_CWD: root,
    },
    root,
  }
}

async function runGuard(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", guardPath, ...args], {
    cwd: env.WANTA_TEST_GUARD_CWD,
    encoding: "utf8",
    env,
  })
  return result.stdout
}

describe("external OO guard runtime", () => {
  test("preserves a managed shell cwd for relative OOCLI data files", async () => {
    const { env, root } = await fixture(
      {
        external: true,
        runtime: "oomol",
        sessionRuntimes: { "session-a": "oomol" },
        sessionTeams: { "session-a": "Team A" },
      },
      '#!/bin/sh\nprintf "cwd=%s\\n" "$PWD"\nfor arg in "$@"; do case "$arg" in @*) cat "${arg#@}" ;; esac; done\n',
    )
    await writeFile(path.join(root, "payload.json"), '{"query":"ok"}\n', "utf8")

    const output = await runGuard(
      ["connector", "run", "posthog", "--action", "run_query", "--data", "@payload.json"],
      env,
    )

    expect(output).toContain(`cwd=${root}`)
    expect(output).toContain('{"query":"ok"}')
  })

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

  test("preserves an explicit Marketplace connection while binding the owning team", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "OOMOL-Internal" },
    })

    const output = await runGuard(
      [
        "connector",
        "run",
        "tikhub",
        "--action",
        "invoke_endpoint",
        "--connection-name",
        "marketplace_oomol",
        "--data",
        "{}",
      ],
      env,
    )
    expect(output.trim().split("\n")).toEqual([
      "connector",
      "run",
      "tikhub",
      "--action",
      "invoke_endpoint",
      "--connection-name",
      "marketplace_oomol",
      "--data",
      "{}",
      "--team",
      "OOMOL-Internal",
    ])
  })

  test("fails before the real CLI when a shared cwd could select different running turns", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol", "session-b": "oomol" },
      sessionTeams: { "session-a": "Team A", "session-b": "Team B" },
    })

    await expect(runGuard(["connector", "run", "posthog", "--action", "list_projects"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("working directory shared by active turns"),
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

  test("allows top-level read-only capability discovery required by the bundled oo skill", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })

    const output = await runGuard(["search", "generate an image with GPT Image 2", "--json"], env)
    expect(output.trim().split("\n")).toEqual(["search", "generate an image with GPT Image 2", "--json"])
  })

  test("allows bounded file transfer and Flow commands", async () => {
    const { env, root } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })
    const upload = path.join(root, "artifact.txt")
    const downloads = path.join(root, "downloads")
    await writeFile(upload, "artifact")

    const uploadOutput = await runGuard(["file", "upload", upload, "--json"], env)
    expect(uploadOutput.trim().split("\n")).toEqual(["file", "upload", upload, "--json"])

    const downloadOutput = await runGuard(
      ["file", "download", "https://93.184.216.34/artifact", downloads, "--name", "artifact"],
      env,
    )
    expect(downloadOutput.trim().split("\n")).toEqual([
      "file",
      "download",
      "https://93.184.216.34/artifact",
      downloads,
      "--name",
      "artifact",
    ])

    const flowOutput = await runGuard(["flow", "inspect", "demo", "--project", "project-a", "--json"], env)
    expect(flowOutput.trim().split("\n")).toEqual(["flow", "inspect", "demo", "--project", "project-a", "--json"])
  })

  test("keeps a live upload URL usable by the agent while transcript redaction remains separate", async () => {
    const { env, root } = await fixture(
      {
        external: true,
        runtime: "oomol",
        sessionRuntimes: { "session-a": "oomol" },
        sessionTeams: { "session-a": "Team A" },
      },
      '#!/bin/sh\nprintf \'{"downloadUrl":"https://signed.example.test/file?token=secret","apiToken":"hidden"}\\n\'\n',
    )
    const upload = path.join(root, "artifact.txt")
    await writeFile(upload, "artifact")

    const output = JSON.parse(await runGuard(["file", "upload", upload, "--json"], env)) as Record<string, unknown>
    expect(output).toEqual({
      downloadUrl: "https://signed.example.test/file?token=secret",
      apiToken: "[redacted]",
    })
  })

  test("rejects unsafe file and Flow boundaries before spawning OOCLI", async () => {
    const { env, root } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })
    await expect(runGuard(["file", "upload", path.dirname(root), "--json"], env)).rejects.toBeDefined()
    await expect(runGuard(["file", "download", "http://127.0.0.1/private"], env)).rejects.toBeDefined()
    await expect(runGuard(["flow", "inspect", "demo", "--json"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("explicit --project"),
    })
    await expect(runGuard(["flow", "delete", "demo", "--project", "project-a", "--yes"], env)).rejects.toBeDefined()
  })

  test("rejects runtime-administration commands at the privileged boundary", async () => {
    const { env } = await fixture({
      external: true,
      runtime: "oomol",
      sessionRuntimes: { "session-a": "oomol" },
      sessionTeams: { "session-a": "Team A" },
    })

    await expect(runGuard(["logout"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Only managed capability, connector, file-transfer, and Flow commands are allowed",
      ),
    })
  })

  test("fails closed before dispatch when packaged OO compatibility is unavailable", async () => {
    const { env } = await fixture(
      {
        external: true,
        runtime: "oomol",
        sessionRuntimes: { "session-a": "oomol" },
        sessionTeams: { "session-a": "Team A" },
      },
      undefined,
      () => false,
    )
    await expect(runGuard(["search", "posthog"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("Managed OO runtime integrity verification failed"),
    })
  })

  test("terminates an active OO command when the guard is disposed", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-guard-cancel-"))
    roots.push(temporaryRoot)
    const root = await realpath(temporaryRoot)
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
    await vi.waitFor(async () => expect(await readFile(startedPath, "utf8")).toBe("started"), { timeout: 5_000 })
    await server.dispose()

    await expect(running).rejects.toBeDefined()
    await vi.waitFor(async () => expect(await readFile(terminatedPath, "utf8")).toBe("terminated"))
  })
})
