import assert from "node:assert/strict"
import path from "node:path"
import { test, vi } from "vitest"
import {
  expandWindowsEnvironmentVariables,
  mergePathValues,
  parseWindowsRegistryPath,
  resetUserCommandPathCacheForTest,
  resolveUserCommandPath,
} from "./command-path.ts"

test("mergePathValues preserves priority while removing empty and duplicate entries", () => {
  assert.equal(
    mergePathValues([
      ["/wanta/bin", "/usr/bin"].join(path.delimiter),
      ["/opt/homebrew/bin", "/usr/bin", ""].join(path.delimiter),
    ]),
    ["/wanta/bin", "/usr/bin", "/opt/homebrew/bin"].join(path.delimiter),
  )
})

test("resolveUserCommandPath puts Wanta binaries before the login shell and fallback paths", async () => {
  const result = await resolveUserCommandPath({
    env: { HOME: "/Users/test", PATH: ["/usr/bin", "/bin"].join(path.delimiter), SHELL: "/bin/zsh" },
    platform: "darwin",
    preferredDirectories: ["/Applications/Wanta.app/Contents/Resources/bin"],
    shellPathReader: async () => ["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
  })

  assert.deepEqual(result.split(path.delimiter), [
    "/Applications/Wanta.app/Contents/Resources/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/Users/test/.local/bin",
  ])
})

test("resolveUserCommandPath falls back without blocking when login shell PATH is unavailable", async () => {
  const result = await resolveUserCommandPath({
    env: { HOME: "/Users/test", PATH: "/usr/bin", SHELL: "/bin/zsh" },
    platform: "darwin",
    preferredDirectories: ["/wanta/bin"],
    shellPathReader: async () => undefined,
  })

  assert.deepEqual(result.split(path.delimiter), [
    "/wanta/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/bin",
    "/Users/test/.local/bin",
  ])
})

test("resolveUserCommandPath does not invoke a Unix login shell on Windows", async () => {
  let called = false
  const result = await resolveUserCommandPath({
    env: {
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      Path: "C:\\Windows\\System32;C:\\Tools",
      ProgramData: "C:\\ProgramData",
      USERPROFILE: "C:\\Users\\test",
    },
    platform: "win32",
    preferredDirectories: ["C:\\Wanta\\bin"],
    shellPathReader: async () => {
      called = true
      return undefined
    },
    windowsPathReader: async () => [
      "C:\\Windows\\System32;C:\\Program Files\\Cloud CLI",
      "C:\\Users\\test\\bin;C:\\TOOLS",
    ],
  })

  assert.equal(called, false)
  assert.deepEqual(result.split(";"), [
    "C:\\Wanta\\bin",
    "C:\\Windows\\System32",
    "C:\\Program Files\\Cloud CLI",
    "C:\\Users\\test\\bin",
    "C:\\TOOLS",
    "C:\\Users\\test\\AppData\\Roaming\\npm",
    "C:\\Users\\test\\scoop\\shims",
    "C:\\ProgramData\\chocolatey\\bin",
    "C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links",
  ])
  assert.doesNotMatch(result, /homebrew|\/usr\/bin|\/bin/)
})

test("resolveUserCommandPath retries an empty Windows registry PATH result", async () => {
  resetUserCommandPathCacheForTest()
  let calls = 0
  const windowsPathReader = async (): Promise<readonly string[]> => {
    calls += 1
    return calls === 1 ? [] : ["C:\\Recovered\\bin"]
  }
  const options = {
    env: process.env,
    platform: "win32" as const,
    windowsPathReader,
  }

  try {
    const first = await resolveUserCommandPath(options)
    const second = await resolveUserCommandPath(options)
    const third = await resolveUserCommandPath(options)

    assert.equal(calls, 2)
    assert.doesNotMatch(first, /C:\\Recovered\\bin/i)
    assert.match(second, /C:\\Recovered\\bin/i)
    assert.equal(third, second)
  } finally {
    resetUserCommandPathCacheForTest()
  }
})

test("resolveUserCommandPath refreshes a successful Windows registry PATH after its TTL", async () => {
  resetUserCommandPathCacheForTest()
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000)
  let calls = 0
  const options = {
    env: process.env,
    platform: "win32" as const,
    windowsPathReader: async (): Promise<readonly string[]> => {
      calls += 1
      return [`C:\\Registry-${calls}\\bin`]
    },
  }

  try {
    const first = await resolveUserCommandPath(options)
    const cached = await resolveUserCommandPath(options)
    now.mockReturnValue(31_001)
    const refreshed = await resolveUserCommandPath(options)

    assert.equal(calls, 2)
    assert.equal(cached, first)
    assert.match(first, /C:\\Registry-1\\bin/i)
    assert.match(refreshed, /C:\\Registry-2\\bin/i)
  } finally {
    now.mockRestore()
    resetUserCommandPathCacheForTest()
  }
})

test("Windows PATH merging uses semicolons and removes case-insensitive duplicates", () => {
  assert.equal(
    mergePathValues(["C:\\Tools;C:\\Windows", "c:\\tools;C:\\Users\\test\\bin"], ";", true),
    "C:\\Tools;C:\\Windows;C:\\Users\\test\\bin",
  )
})

test("Windows registry PATH parsing expands environment variables case-insensitively", () => {
  const env = { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\test" }
  assert.equal(
    parseWindowsRegistryPath(
      "HKEY_LOCAL_MACHINE\\Environment\r\n    Path    REG_EXPAND_SZ    %SYSTEMROOT%\\System32;%UserProfile%\\bin\r\n",
      env,
    ),
    "C:\\Windows\\System32;C:\\Users\\test\\bin",
  )
  assert.equal(expandWindowsEnvironmentVariables("%MISSING%\\bin", env), "%MISSING%\\bin")
})
