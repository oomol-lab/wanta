import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, test } from "vitest"

const execFileAsync = promisify(execFile)
const roots: string[] = []
const guardPath = path.resolve("electron/agent/opencode-oo-guard.ts")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function fixture(
  commandBody = '#!/bin/sh\nprintf "%s\\n" "$@"\n',
): Promise<{ env: NodeJS.ProcessEnv; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-opencode-oo-guard-"))
  roots.push(root)
  const realOo = path.join(root, "real-oo")
  const scopePath = path.join(root, "team-scope.json")
  await writeFile(realOo, commandBody, "utf8")
  await chmod(realOo, 0o755)
  await writeFile(scopePath, JSON.stringify({ sessionTeams: { "session-a": "Team A" }, teamName: "Team A" }))
  return {
    env: {
      ...process.env,
      WANTA_LINK_RUNTIME: "oomol",
      WANTA_REAL_OO_BIN: realOo,
      WANTA_TEAM_SCOPE_PATH: scopePath,
    },
    root,
  }
}

async function runGuard(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", guardPath, ...args], {
    encoding: "utf8",
    env,
  })
  return result.stdout
}

describe("built-in OpenCode OO guard runtime", () => {
  test("runs without the external loopback descriptor and binds the active team", async () => {
    const { env } = await fixture()

    const output = await runGuard(["connector", "run", "posthog", "--action", "list_projects"], env)

    expect(output.trim().split("\n")).toEqual([
      "connector",
      "run",
      "posthog",
      "--action",
      "list_projects",
      "--team",
      "Team A",
    ])
  })

  test("passes non-connector OO commands to the real bundled CLI", async () => {
    const { env } = await fixture()

    const output = await runGuard(["search", "generate an image", "--json"], env)

    expect(output.trim().split("\n")).toEqual(["search", "generate an image", "--json"])
  })

  test("keeps the built-in image edit upload, submit, result, and download chain on managed OO", async () => {
    const commandBody = `#!/bin/sh
printf '%s\\n' "$*" >> "$WANTA_TEST_OO_TRACE"
case "$1 $2" in
  'file upload') printf '{"downloadUrl":"https://signed.example.test/input?token=live","fileName":"input.png"}\\n' ;;
  'connector run')
    case "$5" in
      submit) printf '{"taskId":"image-task-1"}\\n' ;;
      result) printf '{"status":"completed","imageUrl":"https://cdn.example.test/result.png"}\\n' ;;
      *) exit 2 ;;
    esac
    ;;
  'file download') printf 'Saved result.png\\n' ;;
  *) exit 2 ;;
esac
`
    const { env, root } = await fixture(commandBody)
    const tracePath = path.join(root, "oo-trace.txt")
    env.WANTA_TEST_OO_TRACE = tracePath
    const inputPath = path.join(root, "input.png")
    await writeFile(inputPath, "image")

    const upload = JSON.parse(await runGuard(["file", "upload", inputPath, "--json"], env)) as {
      downloadUrl: string
    }
    expect(upload.downloadUrl).toBe("https://signed.example.test/input?token=live")

    const submitted = JSON.parse(
      await runGuard(
        [
          "connector",
          "run",
          "fusion-api",
          "--action",
          "submit",
          "--data",
          JSON.stringify({ imageUrl: upload.downloadUrl }),
          "--json",
        ],
        env,
      ),
    ) as { taskId: string }
    expect(submitted.taskId).toBe("image-task-1")

    const result = JSON.parse(
      await runGuard(
        [
          "connector",
          "run",
          "fusion-api",
          "--action",
          "result",
          "--data",
          JSON.stringify({ taskId: submitted.taskId }),
          "--json",
        ],
        env,
      ),
    ) as { imageUrl: string; status: string }
    expect(result).toEqual({ status: "completed", imageUrl: "https://cdn.example.test/result.png" })

    await expect(
      runGuard(["file", "download", result.imageUrl, root, "--name", "result", "--ext", ".png"], env),
    ).resolves.toContain("Saved result.png")
    const trace = await readFile(tracePath, "utf8")
    expect(trace).toContain("file upload")
    expect(trace).toContain("connector run fusion-api --action submit")
    expect(trace).toContain("connector run fusion-api --action result")
    expect(trace).toContain("file download https://cdn.example.test/result.png")
    expect(trace).not.toMatch(/\b(?:curl|wget|base64)\b/u)
  })
})
