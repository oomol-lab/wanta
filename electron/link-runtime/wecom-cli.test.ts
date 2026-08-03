import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { findOfficialWecomAuthorizationUrl, redactWecomCliOutput, WecomCliManager } from "./wecom-cli.ts"

describe("WeCom CLI authorization URL", () => {
  it("accepts the official QR-code page", () => {
    expect(
      findOfficialWecomAuthorizationUrl(
        "请打开二维码链接扫码: https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=temporary",
      ),
    ).toBe("https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=temporary")
  })

  it("rejects lookalike hosts, ports, protocols, and paths", () => {
    expect(findOfficialWecomAuthorizationUrl("https://work.weixin.qq.com.evil.test/ai/qc/gen?scode=x")).toBeUndefined()
    expect(findOfficialWecomAuthorizationUrl("https://work.weixin.qq.com:8443/ai/qc/gen?scode=x")).toBeUndefined()
    expect(findOfficialWecomAuthorizationUrl("http://work.weixin.qq.com/ai/qc/gen?scode=x")).toBeUndefined()
    expect(findOfficialWecomAuthorizationUrl("https://work.weixin.qq.com/other?scode=x")).toBeUndefined()
    expect(findOfficialWecomAuthorizationUrl("https://work.weixin.qq.com/ai/qc/gen")).toBeUndefined()
  })
})

describe("WeCom CLI error redaction", () => {
  it("removes QR URLs and credentials", () => {
    const value = redactWecomCliOutput(
      'https://work.weixin.qq.com/ai/qc/gen?scode=temporary {"secret":"top-secret","access_token":"token"}',
      1,
    )
    expect(value).not.toContain("temporary")
    expect(value).not.toContain("top-secret")
    expect(value).not.toContain('"token"')
    expect(value).toContain("[authorization-url]")
    expect(value).toContain("exit 1")
  })
})

describe.runIf(process.platform !== "win32")("WeCom CLI lifecycle", () => {
  it("connects by QR code and disconnects only the isolated credential directories", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "wanta-wecom-cli-"))
    try {
      const binaryPath = path.join(base, "wecom-cli")
      const rootDir = path.join(base, "private-runtime")
      const skillsDir = path.join(base, "skills")
      const retained = path.join(rootDir, "retained.txt")
      await mkdir(skillsDir)
      await mkdir(rootDir)
      await writeFile(retained, "keep", "utf-8")
      await writeFile(
        binaryPath,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "wecom-cli 0.1.9"; exit 0; fi
if [ "$1" = "auth" ] && [ "$3" = "--auth-status" ]; then
  if [ -f "$WECOM_CLI_CONFIG_DIR/authorized" ]; then echo authorized; else echo unauthorized; fi
  exit 0
fi
if [ "$1" = "auth" ]; then echo '{"id":"bot-123"}'; exit 0; fi
if [ "$1" = "init" ]; then
  mkdir -p "$WECOM_CLI_CONFIG_DIR"
  echo 'https://work.weixin.qq.com/ai/qc/gen?source=test&scode=temporary'
  touch "$WECOM_CLI_CONFIG_DIR/authorized"
  exit 0
fi
exit 1
`,
        "utf-8",
      )
      await chmod(binaryPath, 0o755)
      const opened: string[] = []
      const manager = new WecomCliManager({
        binaryPath,
        openExternalUrl: (url) => opened.push(url),
        rootDir,
        skillsDir,
      })

      const connected = await manager.connect()
      expect(connected).toMatchObject({
        accountLabel: "bot-123",
        canReopenAuthorization: false,
        connection: "connected",
        phase: "idle",
      })
      expect(opened).toEqual(["https://work.weixin.qq.com/ai/qc/gen?source=test&scode=temporary"])

      const disconnected = await manager.disconnect()
      expect(disconnected.connection).toBe("disconnected")
      await expect(readFile(retained, "utf-8")).resolves.toBe("keep")
      await expect(stat(path.join(rootDir, "config"))).resolves.toMatchObject({})
    } finally {
      await rm(base, { force: true, recursive: true })
    }
  })
})
