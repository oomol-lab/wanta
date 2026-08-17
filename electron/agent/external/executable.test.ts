import assert from "node:assert/strict"
import { test } from "vitest"
import { externalExecutableNeedsShell } from "./executable.ts"

test("only Windows command shims require a shell", () => {
  assert.equal(externalExecutableNeedsShell("C:\\app\\codex-acp.cmd", "win32"), true)
  assert.equal(externalExecutableNeedsShell("C:\\app\\codex-acp.BAT", "win32"), true)
  assert.equal(externalExecutableNeedsShell("C:\\app\\codex-acp.exe", "win32"), false)
  assert.equal(externalExecutableNeedsShell("/app/codex-acp", "darwin"), false)
})
