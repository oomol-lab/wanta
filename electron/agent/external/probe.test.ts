import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseClaudeAuthStatus, parseGrokAuthStatus, probeExternalAgent } from "./probe.ts"

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

describe("parseGrokAuthStatus", () => {
  it("recognizes the successful-command logged-out diagnostic", () => {
    expect(parseGrokAuthStatus("You are not authenticated.\nAvailable models:\n  * grok-4.6")).toEqual({
      status: "logged_out",
    })
  })

  it("recognizes Grok's stderr credential diagnostic", () => {
    expect(parseGrokAuthStatus('Failed to fetch models: Auth("No auth credentials for cli-chat-proxy")')).toEqual({
      status: "logged_out",
    })
  })

  it("does not turn unrelated model failures into a logged-out state", () => {
    expect(parseGrokAuthStatus("Failed to fetch models: connection timed out")).toBeUndefined()
  })
})

describe("Grok login probe", () => {
  it.runIf(process.platform !== "win32")("reports the CLI's explicit logged-out response", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-grok-probe-"))
    temporaryDirectories.push(directory)
    const grokPath = path.join(directory, "grok")
    await writeFile(
      grokPath,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "grok 1.0.5"; exit 0; fi\necho "You are not authenticated."\n',
      "utf8",
    )
    await chmod(grokPath, 0o755)

    const status = await probeExternalAgent("grok", {
      env: { PATH: directory },
      extraBinDirectories: [directory],
      homeDirectory: directory,
    })

    expect(status.binary.status).toBe("detected")
    expect(status.login).toEqual({ status: "logged_out" })
  })
})
