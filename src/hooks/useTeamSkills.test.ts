import assert from "node:assert/strict"
import { test } from "vitest"
import { normalizeTeamSkillCacheEntry, selectTeamSkillCacheEntries } from "./useTeamSkills.ts"

test("selectTeamSkillCacheEntries drops expired entries and caps the newest entries", () => {
  const now = Date.UTC(2026, 6, 19)
  const hour = 60 * 60 * 1000
  const entries = [
    { cacheKey: "old", fetchedAt: now - 25 * hour, teamId: "old", skills: [] },
    { cacheKey: "third", fetchedAt: now - 3 * hour, teamId: "third", skills: [] },
    { cacheKey: "first", fetchedAt: now - hour, teamId: "first", skills: [] },
    { cacheKey: "second", fetchedAt: now - 2 * hour, teamId: "second", skills: [] },
  ]

  assert.deepEqual(
    selectTeamSkillCacheEntries(entries, now, 2).map((entry) => entry.cacheKey),
    ["first", "second"],
  )
})

test("normalizeTeamSkillCacheEntry migrates legacy organization ids", () => {
  assert.deepEqual(
    normalizeTeamSkillCacheEntry({
      cacheKey: "account\0team-1",
      fetchedAt: 1_000,
      organizationId: "team-1",
      skills: [],
    }),
    { cacheKey: "account\0team-1", fetchedAt: 1_000, teamId: "team-1", skills: [] },
  )
})
