import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { ensureOoGuardCommandBin } from "./oo-guard-bin.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("managed oo command shim", () => {
  test("creates a POSIX launcher through Electron's Node mode", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "wanta-oo-guard-"))
    roots.push(binDir)
    await ensureOoGuardCommandBin({
      binDir,
      nodeBin: "/Applications/Wanta.app/Contents/MacOS/Wanta",
      ooGuardCliPath: "/Applications/Wanta.app/Contents/Resources/app.asar/dist-electron/wanta-oo-guard.js",
      platform: "darwin",
    })
    const source = await readFile(path.join(binDir, "oo"), "utf8")
    expect(source).toContain("ELECTRON_RUN_AS_NODE=1")
    expect(source).toContain("wanta-oo-guard.js")
    expect(source).toContain('"$@"')
  })

  test("creates a Windows cmd launcher", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "wanta-oo-guard-"))
    roots.push(binDir)
    await ensureOoGuardCommandBin({
      binDir,
      nodeBin: "C:\\Wanta\\Wanta.exe",
      ooGuardCliPath: "C:\\Wanta\\resources\\wanta-oo-guard.js",
      platform: "win32",
    })
    const source = await readFile(path.join(binDir, "oo.cmd"), "utf8")
    expect(source).toContain("set ELECTRON_RUN_AS_NODE=1")
    expect(source).toContain("%*")
  })
})
