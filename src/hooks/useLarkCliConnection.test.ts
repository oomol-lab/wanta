import type { LarkCliState } from "../../electron/link-runtime/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { larkCliProviderFromState } from "./useLarkCliConnection.ts"

const connectedState: LarkCliState = {
  activeVersion: "1.0.81",
  available: true,
  bundledVersion: "1.0.81",
  connection: "connected",
  phase: "idle",
  updateStatus: "current",
}

test("Lark CLI provider preserves the connection transition timestamp", () => {
  const provider = larkCliProviderFromState(connectedState, { description: "Lark", displayName: "Lark CLI" }, 123_456)

  assert.equal(provider.connectedUpdatedAt, 123_456)
  assert.equal(provider.apps[0]?.createdAt, 123_456)
  assert.equal(provider.apps[0]?.updatedAt, 123_456)
})
