import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureCommandSandboxPlugin } from "./plugin.ts"
import { ensureCommandSandboxShellBin } from "./shell-bin.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("command sandbox runtime files", () => {
  it("writes an executable shell shim without embedding policy credentials", async () => {
    const root = await temporaryRoot()
    const commandPath = await ensureCommandSandboxShellBin({
      binDir: path.join(root, "bin"),
      cliPath: "/Applications/Wanta.app/Contents/Resources/app.asar/dist-electron/wanta-command-shell.js",
      nodeBin: "/Applications/Wanta.app/Contents/MacOS/Wanta",
    })
    const source = await readFile(commandPath, "utf8")

    expect((await stat(commandPath)).mode & 0o111).not.toBe(0)
    expect(source).toContain("ELECTRON_RUN_AS_NODE=1")
    expect(source).toContain('"$@"')
    expect(source).not.toContain("WANTA_COMMAND_SANDBOX_AUTH")
  })

  it("writes a shell.env plugin that resolves the root OpenCode session", async () => {
    const root = await temporaryRoot()
    const pluginUrl = await ensureCommandSandboxPlugin(root)
    const source = await readFile(new URL(pluginUrl), "utf8")

    expect(source).toContain('"shell.env"')
    expect(source).toContain("result.data?.parentID")
    expect(source).toContain("WANTA_COMMAND_SANDBOX_SESSION_ID")
    expect(source).toContain("if (!input.sessionID || !input.callID) return")
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-command-sandbox-runtime-"))
  temporaryRoots.push(root)
  return root
}
