import type { SkillInventory } from "../../../electron/skills/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { runRegistrySkillUpdate } from "./registry-skill-update.ts"

const inventory: SkillInventory = {
  groups: [],
  summary: {
    localSkills: 0,
    managedSkills: 0,
    modifiedHosts: 0,
    needsAttention: 0,
    publishableSkills: 0,
    registrySkills: 0,
    sourceMissingHosts: 0,
    skills: [],
  },
  updatedAt: "2026-08-11T00:00:00.000Z",
}

test("runRegistrySkillUpdate finishes without waiting for the background version refresh", async () => {
  let resolveRefresh: (() => void) | undefined
  const refresh = new Promise<void>((resolve) => {
    resolveRefresh = resolve
  })
  const events: string[] = []

  const result = await runRegistrySkillUpdate({
    invalidateVersions: () => events.push("versions-invalidated"),
    refreshVersions: () => {
      events.push("version-refresh-started")
      return refresh
    },
    reportVersionRefreshError: () => events.push("version-refresh-failed"),
    setInventory: () => events.push("inventory-set"),
    update: async () => {
      events.push("update-completed")
      return inventory
    },
  })

  assert.equal(result, inventory)
  assert.deepEqual(events, ["update-completed", "inventory-set", "versions-invalidated", "version-refresh-started"])

  resolveRefresh?.()
  await refresh
})

test("runRegistrySkillUpdate reports a background refresh failure without rejecting the update", async () => {
  const refreshError = new Error("version check timed out")
  const reported: unknown[] = []

  await assert.doesNotReject(() =>
    runRegistrySkillUpdate({
      invalidateVersions: () => undefined,
      refreshVersions: () => Promise.reject(refreshError),
      reportVersionRefreshError: (cause) => reported.push(cause),
      setInventory: () => undefined,
      update: async () => inventory,
    }),
  )
  await Promise.resolve()

  assert.deepEqual(reported, [refreshError])
})

test("runRegistrySkillUpdate rejects when the actual update fails and does not start a version refresh", async () => {
  const updateError = new Error("update failed")
  let refreshStarted = false

  await assert.rejects(
    runRegistrySkillUpdate({
      invalidateVersions: () => undefined,
      refreshVersions: async () => {
        refreshStarted = true
      },
      reportVersionRefreshError: () => undefined,
      setInventory: () => undefined,
      update: async () => Promise.reject(updateError),
    }),
    updateError,
  )

  assert.equal(refreshStarted, false)
})
