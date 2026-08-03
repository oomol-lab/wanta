import { describe, expect, it } from "vitest"
import { resolveWecomCliTarget, safeSkillPath, tarEntries, wecomCliBinaryName } from "./wecom-cli.ts"

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, "utf-8")
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii")
  header[156] = "0".charCodeAt(0)
  return header
}

describe("WeCom CLI build target", () => {
  it("maps every officially supported desktop target", () => {
    expect(resolveWecomCliTarget("darwin", "arm64")).toEqual({
      binaryName: "wecom-cli",
      packageName: "@wecom/cli-darwin-arm64",
    })
    expect(resolveWecomCliTarget("darwin", "x64").packageName).toBe("@wecom/cli-darwin-x64")
    expect(resolveWecomCliTarget("linux", "arm64").packageName).toBe("@wecom/cli-linux-arm64")
    expect(resolveWecomCliTarget("linux", "x64").packageName).toBe("@wecom/cli-linux-x64")
    expect(resolveWecomCliTarget("win32", "x64")).toEqual({
      binaryName: "wecom-cli.exe",
      packageName: "@wecom/cli-win32-x64",
    })
  })

  it("rejects unsupported targets", () => {
    expect(() => resolveWecomCliTarget("win32", "arm64")).toThrow("No prebuilt WeCom CLI binary")
    expect(() => resolveWecomCliTarget("linux", "riscv64")).toThrow("No prebuilt WeCom CLI binary")
    expect(() => resolveWecomCliTarget("freebsd", "x64")).toThrow("No prebuilt WeCom CLI binary")
  })

  it("uses the platform executable name", () => {
    expect(wecomCliBinaryName("win32")).toBe("wecom-cli.exe")
    expect(wecomCliBinaryName("darwin")).toBe("wecom-cli")
  })
})

describe("WeCom CLI Skill archive", () => {
  it("rejects traversal and absolute Skill paths", () => {
    expect(safeSkillPath("wecomcli-doc/SKILL.md")).toBe(true)
    expect(safeSkillPath("wecomcli-doc/../secret")).toBe(false)
    expect(safeSkillPath("/absolute/SKILL.md")).toBe(false)
    expect(safeSkillPath("C:\\absolute\\SKILL.md")).toBe(false)
  })

  it("rejects truncated and oversized tar entries", () => {
    expect(() => tarEntries(tarHeader("truncated", 1))).toThrow("Invalid or truncated")
    expect(() => tarEntries(tarHeader("oversized", Number.parseInt("77777777777", 8)))).toThrow("Invalid or truncated")
  })

  it("rejects a tar size field with a trailing non-octal character", () => {
    const header = tarHeader("malformed-size", 1)
    header.write("00000000001x", 124, 12, "ascii")
    const archive = Buffer.concat([header, Buffer.alloc(512)])

    expect(() => tarEntries(archive)).toThrow("Invalid or truncated")
  })

  it("parses a complete padded tar entry", () => {
    const archive = Buffer.concat([tarHeader("skill/SKILL.md", 4), Buffer.from("test"), Buffer.alloc(508)])
    expect(tarEntries(archive)).toEqual([{ data: Buffer.from("test"), path: "skill/SKILL.md", type: "0" }])
  })
})
