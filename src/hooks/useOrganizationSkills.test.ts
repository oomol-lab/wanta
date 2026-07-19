import assert from "node:assert/strict"
import { test } from "vitest"
import { selectOrganizationSkillCacheEntries } from "./useOrganizationSkills.ts"

test("selectOrganizationSkillCacheEntries drops expired entries and caps the newest entries", () => {
  const now = Date.UTC(2026, 6, 19)
  const hour = 60 * 60 * 1000
  const entries = [
    { cacheKey: "old", fetchedAt: now - 25 * hour, organizationId: "old", skills: [] },
    { cacheKey: "third", fetchedAt: now - 3 * hour, organizationId: "third", skills: [] },
    { cacheKey: "first", fetchedAt: now - hour, organizationId: "first", skills: [] },
    { cacheKey: "second", fetchedAt: now - 2 * hour, organizationId: "second", skills: [] },
  ]

  assert.deepEqual(
    selectOrganizationSkillCacheEntries(entries, now, 2).map((entry) => entry.cacheKey),
    ["first", "second"],
  )
})
