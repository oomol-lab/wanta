import assert from "node:assert/strict"
import { test } from "vitest"
import { storedTeamIdFromValue } from "./useTeamWorkspace.ts"

test("storedTeamIdFromValue accepts team ids and migrates legacy organization ids", () => {
  assert.equal(storedTeamIdFromValue({ teamId: " team-1 " }), "team-1")
  assert.equal(storedTeamIdFromValue({ organizationId: " team-1 " }), "team-1")
  assert.equal(storedTeamIdFromValue({ teamId: "team-1", organizationId: "team-1" }), "team-1")
  assert.equal(storedTeamIdFromValue({ organizationId: 1 }), null)
})
