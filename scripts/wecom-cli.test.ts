import { describe, expect, it } from "vitest"
import { resolveWecomCliTarget, wecomCliBinaryName } from "./wecom-cli.ts"

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
