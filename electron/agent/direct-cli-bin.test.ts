import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { ensureDirectCliCommandBin } from "./direct-cli-bin.ts"

const execFileAsync = promisify(execFile)

describe("ensureDirectCliCommandBin", () => {
  it("writes forwarding shims only for connected direct CLIs", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "wanta-direct-cli-bin-"))
    try {
      const binDir = path.join(base, "bin")
      const larkCliBinPath = path.join(base, "managed lark-cli")
      await writeFile(larkCliBinPath, "#!/bin/sh\nprintf 'forwarded:%s' \"$1\"\n", "utf-8")
      await chmod(larkCliBinPath, 0o755)

      await ensureDirectCliCommandBin({ binDir, larkCliBinPath })

      if (process.platform === "win32") {
        expect(await readFile(path.join(binDir, "lark-cli.cmd"), "utf-8")).toContain(`"${larkCliBinPath}" %*`)
        expect(await readFile(path.join(binDir, "wecom-cli.cmd"), "utf-8")).toContain("exit /b 69")
        expect(await readFile(path.join(binDir, "dws.cmd"), "utf-8")).toContain("exit /b 69")
      } else {
        await expect(execFileAsync(path.join(binDir, "lark-cli"), ["calendar.list"])).resolves.toMatchObject({
          stdout: "forwarded:calendar.list",
        })
        await expect(execFileAsync(path.join(binDir, "wecom-cli"))).rejects.toMatchObject({
          code: 69,
          stderr: expect.stringContaining("WeCom CLI is not connected"),
        })
        await expect(execFileAsync(path.join(binDir, "dws"))).rejects.toMatchObject({
          code: 69,
          stderr: expect.stringContaining("DingTalk CLI is not connected"),
        })
      }
    } finally {
      await rm(base, { force: true, recursive: true })
    }
  })
})
