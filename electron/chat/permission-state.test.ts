import assert from "node:assert/strict"
import { test } from "vitest"
import { PermissionState } from "./permission-state.ts"

test("permission mode versions reject stale renderer updates", () => {
  const state = new PermissionState()
  assert.equal(state.setMode("session-1", "full_access", 2), true)
  assert.equal(state.setMode("session-1", "default", 1), false)
  assert.equal(state.mode("session-1"), "full_access")
})

test("automatic permission replies are deduplicated until completion", () => {
  const state = new PermissionState()
  assert.equal(state.beginAutomaticReply("session-1", "request-1"), true)
  assert.equal(state.beginAutomaticReply("session-1", "request-1"), false)
  state.endAutomaticReply("session-1", "request-1")
  assert.equal(state.beginAutomaticReply("session-1", "request-1"), true)
})

test("generation grants are removed without discarding session grants", () => {
  const state = new PermissionState()
  state.addGrant("session-1", { action: "bash", kind: "request", patterns: ["git status"] })
  state.addGrant("session-1", {
    action: "bash",
    generationId: "generation-1",
    kind: "python_dependency_install",
    patterns: ["pandas"],
    processRoot: "/tmp/process",
  })

  state.removeGenerationGrants("session-1", "generation-1")
  assert.deepEqual(state.sessionGrants("session-1"), [{ action: "bash", kind: "request", patterns: ["git status"] }])
})
