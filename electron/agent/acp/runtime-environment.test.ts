import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { acpSubprocessEnvironment } from "./adapter.ts"
import { ACP_AGENT_REGISTRY } from "./registry.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("ACP subprocess environment", () => {
  test.runIf(process.platform !== "win32")("injects the resolved Codex CLI path for the packaged bridge", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-acp-runtime-"))
    temporaryDirectories.push(directory)
    const codexPath = path.join(directory, "codex")
    await writeFile(codexPath, "#!/bin/sh\nexit 0\n", "utf8")
    await chmod(codexPath, 0o755)

    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY.codex, directory, {})

    expect(env.CODEX_PATH).toBe(codexPath)
    expect(env.PATH).toBe(directory)
    expect(env.WANTA_NODE_RUNTIME).toBe(process.execPath)
  })

  test("preserves an explicit bridge runtime override", async () => {
    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY.codex, "", {
      CODEX_PATH: "/custom/codex",
    })

    expect(env.CODEX_PATH).toBe("/custom/codex")
  })

  test("fails clearly when the bridge runtime is unavailable", async () => {
    await expect(acpSubprocessEnvironment(ACP_AGENT_REGISTRY.codex, "", {})).rejects.toThrow(
      "Codex CLI was not found on this machine",
    )
  })

  test("leaves agents without a delegated runtime unchanged", async () => {
    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY.grok, "/bin", { SAMPLE: "value" })

    expect(env).toMatchObject({ PATH: "/bin", SAMPLE: "value", WANTA_NODE_RUNTIME: process.execPath })
    expect(env.CODEX_PATH).toBeUndefined()
  })
})
