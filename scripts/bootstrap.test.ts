import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { preferredWorktreePort, renderEnvScript, shellQuote } from "./bootstrap.ts"

describe("bootstrap helpers", () => {
  test("preferredWorktreePort is stable and bounded", () => {
    const portA = preferredWorktreePort("/tmp/worktree-a")
    const portB = preferredWorktreePort("/tmp/worktree-a")
    const portC = preferredWorktreePort("/tmp/worktree-b")

    assert.equal(portA, portB)
    assert.ok(portA >= 5273)
    assert.ok(portA < 6273)
    assert.notEqual(portA, portC)
  })

  test("shellQuote escapes single quotes", () => {
    assert.equal(shellQuote("a'b"), "'a'\\''b'")
  })

  test("renderEnvScript emits shell exports", () => {
    const script = renderEnvScript({
      WANTA_DEV_SERVER_PORT: "6000",
      WANTA_SKIP_PROTOCOL_REGISTRATION: "1",
      WANTA_USER_DATA_DIR: "/tmp/wanta",
    })

    assert.match(script, /export WANTA_DEV_SERVER_PORT='6000'/)
    assert.match(script, /export WANTA_SKIP_PROTOCOL_REGISTRATION='1'/)
    assert.match(script, /export WANTA_USER_DATA_DIR='\/tmp\/wanta'/)
  })
})
