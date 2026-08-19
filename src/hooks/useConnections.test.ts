import assert from "node:assert/strict"
import { test } from "vitest"
import { connectionManagementActionUnavailableMessage } from "./useConnections.ts"

test("connection management actions distinguish a pending workspace from a read-only team", () => {
  assert.equal(connectionManagementActionUnavailableMessage(null), "Workspace is still loading.")
  assert.equal(
    connectionManagementActionUnavailableMessage({ manageable: false, teamName: "read-only" }),
    "Connection management is not allowed in this team.",
  )
  assert.equal(connectionManagementActionUnavailableMessage({ manageable: true, teamName: "managed" }), null)
})
