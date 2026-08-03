import { describe, expect, test } from "vitest"
import { dingTalkCliBinaryName, resolveDingTalkCliTarget, safeDingTalkSkillPath } from "./dingtalk-cli.ts"

describe("DingTalk CLI packaging", () => {
  test("maps supported release targets", () => {
    expect(resolveDingTalkCliTarget("darwin", "arm64")).toEqual({
      archiveKind: "tar.gz",
      assetName: "dws-darwin-arm64.tar.gz",
      binaryPath: "./dws",
    })
    expect(resolveDingTalkCliTarget("linux", "x64").assetName).toBe("dws-linux-amd64.tar.gz")
    expect(resolveDingTalkCliTarget("win32", "arm64")).toEqual({
      archiveKind: "zip",
      assetName: "dws-windows-arm64.zip",
      binaryPath: "dws.exe",
    })
    expect(dingTalkCliBinaryName("win32")).toBe("dws.exe")
  })

  test("rejects unsupported release targets", () => {
    expect(() => resolveDingTalkCliTarget("darwin", "riscv64")).toThrow(/No prebuilt DingTalk CLI/u)
    expect(() => resolveDingTalkCliTarget("freebsd", "x64")).toThrow(/No prebuilt DingTalk CLI/u)
  })

  test("accepts only safe skill paths", () => {
    expect(safeDingTalkSkillPath("references/products/calendar.md")).toBe(true)
    expect(safeDingTalkSkillPath("../SKILL.md")).toBe(false)
    expect(safeDingTalkSkillPath("references/../../secret")).toBe(false)
    expect(safeDingTalkSkillPath("/tmp/SKILL.md")).toBe(false)
    expect(safeDingTalkSkillPath("C:\\temp\\SKILL.md")).toBe(false)
  })
})
