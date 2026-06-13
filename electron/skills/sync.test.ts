import assert from "node:assert/strict"
import { test } from "vitest"
import { createSkillSyncArgs } from "./sync.ts"

test("createSkillSyncArgs creates oo-cli registry sync commands", () => {
  assert.deepEqual(createSkillSyncArgs("apply"), ["skills", "sync", "apply", "--json"])
  assert.deepEqual(createSkillSyncArgs("upload"), ["skills", "sync", "upload", "--json"])
})
