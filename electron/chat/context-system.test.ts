import assert from "node:assert/strict"
import { test } from "vitest"
import { buildPermissionModeSystem } from "./context-system.ts"

test("buildPermissionModeSystem describes default permission", () => {
  const prompt = buildPermissionModeSystem("default")

  assert.match(prompt, /Default Permission/)
  assert.match(prompt, /Wanta-controlled app APIs/)
  assert.match(prompt, /oo CLI commands are pre-approved/)
  assert.match(prompt, /specific command or path/)
  assert.doesNotMatch(prompt, /user has enabled Full Access/)
})

test("buildPermissionModeSystem describes full access", () => {
  const prompt = buildPermissionModeSystem("full_access")

  assert.match(prompt, /Full Access/)
  assert.match(prompt, /edit files/)
  assert.match(prompt, /access external filesystem paths/)
  assert.match(prompt, /Local permission requests are auto-approved/)
  assert.doesNotMatch(prompt, /High-risk destructive shell commands/)
  assert.doesNotMatch(prompt, /confirm destructive business actions/)
})
