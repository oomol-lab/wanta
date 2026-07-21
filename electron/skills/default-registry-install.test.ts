import assert from "node:assert/strict"
import { test } from "vitest"
import {
  normalizeDefaultRegistryReplacementSkillIds,
  normalizeDefaultRegistrySkillRequest,
} from "./default-registry-install.ts"

test("normalizes default registry Skill requests", () => {
  assert.deepEqual(
    normalizeDefaultRegistrySkillRequest({
      enabled: true,
      packageName: " @oomol/example ",
      skillId: " example-skill ",
    }),
    {
      packageName: "@oomol/example",
      skillId: "example-skill",
    },
  )
})

test("normalizes unique replacement Skill ids and omits the current id", () => {
  assert.deepEqual(
    normalizeDefaultRegistryReplacementSkillIds({
      enabled: true,
      packageName: "@oomol/example",
      replacesSkillIds: [" legacy-skill ", "legacy-skill", "current-skill"],
      skillId: "current-skill",
    }),
    ["legacy-skill"],
  )
})
