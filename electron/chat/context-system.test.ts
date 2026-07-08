import assert from "node:assert/strict"
import { test } from "vitest"
import { buildPermissionModeSystem } from "./context-system.ts"

test("buildPermissionModeSystem describes default access", () => {
  const prompt = buildPermissionModeSystem("default")

  assert.match(prompt, /Default Access/)
  assert.match(prompt, /Use bash normally/)
  assert.match(prompt, /Ordinary shell commands/)
  assert.match(prompt, /credential\/secret paths/)
  assert.match(prompt, /dependency installation/)
  assert.doesNotMatch(prompt, /user has enabled Full Access/)
})

test("buildPermissionModeSystem describes full access", () => {
  const prompt = buildPermissionModeSystem("full_access")

  assert.match(prompt, /Full Access \(session-scoped local YOLO\)/)
  assert.match(prompt, /YOLO for local tools/)
  assert.match(prompt, /edit files/)
  assert.match(prompt, /access external filesystem paths/)
  assert.match(prompt, /Local permission requests are auto-approved/)
  assert.match(prompt, /Do not ask the user to switch modes or approve local tool calls/)
  assert.match(prompt, /non-local business workflow explicitly requires user approval/)
})
