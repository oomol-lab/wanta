import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ACP_AGENT_REGISTRY } from "../acp/registry.ts"
import { parseClaudeAuthStatus, probeRegisteredRuntime, shouldProbeExternalAgentLogin } from "./probe.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("parseClaudeAuthStatus", () => {
  it("recognizes the current Claude CLI logged-in response", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "oauth" }))).toEqual({
      status: "logged_in",
    })
  })

  it("recognizes an explicit logged-out response", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ status: "logged_out" })
  })

  it("falls back when the command is unsupported or malformed", () => {
    expect(parseClaudeAuthStatus("unknown command: auth")).toBeUndefined()
    expect(parseClaudeAuthStatus(JSON.stringify({ authenticated: true }))).toBeUndefined()
  })
})

describe("shouldProbeExternalAgentLogin", () => {
  it("only probes a detected agent-owned CLI", () => {
    const cliAuth = { kind: "agent-cli" as const, loginCommand: "agent login" }
    expect(shouldProbeExternalAgentLogin(cliAuth, { status: "detected", path: "/bin/agent" })).toBe(true)
    expect(shouldProbeExternalAgentLogin(cliAuth, { status: "not_found" })).toBe(false)
    expect(shouldProbeExternalAgentLogin(cliAuth, { status: "error", message: "version failed" })).toBe(false)
    expect(shouldProbeExternalAgentLogin({ kind: "wanta-account" }, { status: "detected", path: "/bin/harness" })).toBe(
      false,
    )
  })
})

describe("probeRegisteredRuntime", () => {
  it("rejects an invalid explicit native runtime override", async () => {
    const missing = path.join(os.tmpdir(), "wanta-missing-codex-runtime")
    await expect(
      probeRegisteredRuntime(ACP_AGENT_REGISTRY.codex, "", { env: { CODEX_PATH: missing } }),
    ).resolves.toEqual({
      status: "not_found",
      message: expect.stringContaining("set CODEX_PATH to a valid executable path"),
    })
  })

  it.runIf(process.platform !== "win32")("detects the native CLI required by a packaged bridge", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-probe-runtime-"))
    temporaryDirectories.push(directory)
    const codexPath = path.join(directory, "codex")
    await writeFile(codexPath, "#!/bin/sh\nexit 0\n", "utf8")
    await chmod(codexPath, 0o755)

    await expect(probeRegisteredRuntime(ACP_AGENT_REGISTRY.codex, directory, { env: {} })).resolves.toEqual({
      status: "detected",
      path: codexPath,
    })
  })

  it("does nothing for agents that launch their native runtime directly", async () => {
    await expect(probeRegisteredRuntime(ACP_AGENT_REGISTRY.grok, "", { env: {} })).resolves.toEqual({
      status: "not_required",
    })
  })
})
