import assert from "node:assert/strict"
import { test } from "vitest"
import { listSkillEditorApps, resolveEditorCommand } from "./editor-launcher.ts"
import { launchEditorCommand } from "./editor-launcher.ts"

class FakeSpawnProcess {
  public on(event: "error", listener: (cause: Error) => void): this
  public on(event: "spawn", listener: () => void): this
  public on(event: "error" | "spawn", listener: ((cause: Error) => void) | (() => void)): this {
    if (event === "spawn") {
      queueMicrotask(() => {
        ;(listener as () => void)()
      })
    }
    return this
  }

  public unref(): void {}
}

test("resolveEditorCommand prefers an available editor CLI", async () => {
  const calls: string[] = []
  const editor = await resolveEditorCommand({
    accessPath: async () => {
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command, args) => {
      calls.push([command, ...args].join(" "))
      if (command === "code") {
        return { stderr: "", stdout: "1.0.0" }
      }
      throw new Error("missing")
    },
    platform: "linux",
  })

  assert.deepEqual(editor, { args: ["--reuse-window"], command: "code" })
  assert.deepEqual(calls, ["code --version"])
})

test("resolveEditorCommand can target a selected editor", async () => {
  const calls: string[] = []
  const editor = await resolveEditorCommand({
    editorId: "cursor",
    env: { PATH: "/usr/bin" },
    execFile: async (command, args) => {
      calls.push([command, ...args].join(" "))
      if (command === "cursor") {
        return { stderr: "", stdout: "1.0.0" }
      }
      throw new Error("missing")
    },
    platform: "linux",
  })

  assert.deepEqual(editor, { args: ["--reuse-window"], command: "cursor" })
  assert.deepEqual(calls, ["cursor --version"])
})

test("resolveEditorCommand prefers the selected macOS app over a mismatched CLI shim", async () => {
  const editor = await resolveEditorCommand({
    accessPath: async (pathname) => {
      if (pathname === "/Applications/Visual Studio Code.app") {
        return
      }
      throw new Error("missing")
    },
    editorId: "vscode",
    env: { PATH: "/usr/bin" },
    execFile: async (command, args) => {
      if (command === "code" && args[0] === "--version") {
        return { stderr: "", stdout: "3.5.33" }
      }
      if (command === "which" && args[0] === "code") {
        return { stderr: "", stdout: "/usr/local/bin/code\n" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
    realpathPath: async (pathname) => {
      if (pathname === "/usr/local/bin/code") {
        return "/Applications/Cursor.app/Contents/Resources/app/bin/code"
      }
      return pathname
    },
  })

  assert.deepEqual(editor, { args: ["-a", "Visual Studio Code"], command: "open" })
})

test("listSkillEditorApps does not label Cursor's code shim as VS Code", async () => {
  const apps = await listSkillEditorApps({
    accessPath: async (pathname) => {
      if (pathname === "/Applications/Cursor.app") {
        return
      }
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command, args) => {
      if (command === "code" && args[0] === "--version") {
        return { stderr: "", stdout: "3.5.33" }
      }
      if (command === "which" && args[0] === "code") {
        return { stderr: "", stdout: "/usr/local/bin/code\n" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
    realpathPath: async (pathname) => {
      if (pathname === "/usr/local/bin/code") {
        return "/Applications/Cursor.app/Contents/Resources/app/bin/code"
      }
      return pathname
    },
  })

  assert.equal(
    apps.some((app) => app.id === "vscode"),
    false,
  )
  assert.deepEqual(apps[0], {
    available: true,
    id: "cursor",
    isDefault: true,
    name: "Cursor",
  })
})

test("resolveEditorCommand can launch an installed macOS app without CLI", async () => {
  const editor = await resolveEditorCommand({
    accessPath: async (pathname) => {
      if (pathname === "/Applications/Visual Studio Code.app") {
        return
      }
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async () => {
      throw new Error("missing")
    },
    platform: "darwin",
  })

  assert.deepEqual(editor, { args: ["-a", "Visual Studio Code"], command: "open" })
})

test("listSkillEditorApps returns detected editors in preference order", async () => {
  const apps = await listSkillEditorApps({
    accessPath: async () => {
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command) => {
      if (command === "cursor") {
        return { stderr: "", stdout: "1.0.0" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
  })

  assert.deepEqual(apps.slice(0, 2), [
    {
      available: true,
      id: "cursor",
      isDefault: true,
      name: "Cursor",
    },
    {
      available: true,
      id: "system",
      isDefault: false,
      name: "System default",
    },
  ])
})

test("resolveEditorCommand can detect Antigravity CLI", async () => {
  const editor = await resolveEditorCommand({
    accessPath: async () => {
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command) => {
      if (command === "antigravity") {
        return { stderr: "", stdout: "1.0.0" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
  })

  assert.deepEqual(editor, { args: ["--reuse-window"], command: "antigravity" })
})

test("resolveEditorCommand falls back to a running macOS editor process", async () => {
  const editor = await resolveEditorCommand({
    accessPath: async () => {
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command) => {
      if (command === "ps") {
        return { stderr: "", stdout: "/Applications/Cursor.app/Contents/MacOS/Cursor\n" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
  })

  assert.deepEqual(editor, { args: ["--reuse-window"], command: "cursor" })
})

test("resolveEditorCommand matches Linux editor process names exactly", async () => {
  const editor = await resolveEditorCommand({
    env: { PATH: "/usr/bin" },
    execFile: async (command) => {
      if (command === "ps") {
        return { stderr: "", stdout: "code-insiders\n" }
      }
      throw new Error("missing")
    },
    platform: "linux",
  })

  assert.deepEqual(editor, { args: ["--reuse-window"], command: "code-insiders" })
})

test("resolveEditorCommand keeps a relocated macOS editor executable when no CLI mapping is needed", async () => {
  const editor = await resolveEditorCommand({
    accessPath: async () => {
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command) => {
      if (command === "ps") {
        return { stderr: "", stdout: "/Users/alice/Applications/WebStorm.app/Contents/MacOS/webstorm\n" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
  })

  assert.deepEqual(editor, { args: [], command: "/Users/alice/Applications/WebStorm.app/Contents/MacOS/webstorm" })
})

test("resolveEditorCommand returns undefined when no supported editor is found", async () => {
  const editor = await resolveEditorCommand({
    accessPath: async () => {
      throw new Error("missing")
    },
    env: { PATH: "/usr/bin" },
    execFile: async (command) => {
      if (command === "ps") {
        return { stderr: "", stdout: "/Applications/Xcode.app/Contents/MacOS/Xcode\n" }
      }
      throw new Error("missing")
    },
    platform: "darwin",
  })

  assert.equal(editor, undefined)
})

test("launchEditorCommand resolves after the editor process spawns", async () => {
  const calls: unknown[] = []
  await launchEditorCommand({ args: ["--reuse-window"], command: "code" }, "/tmp/demo", {
    env: { PATH: "/usr/bin" },
    spawn: (command, args, options) => {
      calls.push(command, args, options)
      return new FakeSpawnProcess()
    },
  })

  assert.equal(calls[0], "code")
  assert.deepEqual(calls[1], ["--reuse-window", "/tmp/demo"])
})
