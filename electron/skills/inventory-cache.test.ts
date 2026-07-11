import type { SkillInventory } from "./common.ts"

import { describe, expect, it, vi } from "vitest"
import { SkillInventoryCache } from "./inventory-cache.ts"

function inventory(updatedAt: string): SkillInventory {
  return {
    groups: [],
    summary: {
      localSkills: 0,
      managedSkills: 0,
      modifiedHosts: 0,
      needsAttention: 0,
      publishableSkills: 0,
      registrySkills: 0,
      skills: [],
      sourceMissingHosts: 0,
    },
    updatedAt,
  }
}

describe("SkillInventoryCache", () => {
  it("reuses a cached inventory until its TTL expires", async () => {
    let now = 1_000
    const cache = new SkillInventoryCache({ now: () => now, ttlMs: 5_000 })
    const load = vi.fn(async () => inventory(String(now)))

    const first = await cache.get({ writeManifest: true }, load)
    now = 5_999
    const cached = await cache.get({ writeManifest: true }, load)
    now = 6_000
    const expired = await cache.get({ writeManifest: true }, load)

    expect(cached).toBe(first)
    expect(expired).not.toBe(first)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("invalidates cached and in-flight reads after a file change", async () => {
    let finish!: (value: SkillInventory) => void
    const cache = new SkillInventoryCache()
    const firstLoad = vi.fn(
      () =>
        new Promise<SkillInventory>((resolve) => {
          finish = resolve
        }),
    )
    const stale = cache.get({ writeManifest: true }, firstLoad)

    cache.invalidate()
    const freshInventory = inventory("fresh")
    const freshLoad = vi.fn(async () => freshInventory)
    expect(await cache.get({ writeManifest: true }, freshLoad)).toBe(freshInventory)

    finish(inventory("stale"))
    await stale
    expect(await cache.get({ writeManifest: true }, freshLoad)).toBe(freshInventory)
    expect(freshLoad).toHaveBeenCalledTimes(1)
  })

  it("coalesces compatible reads but upgrades a non-persisting read", async () => {
    let finishWeak!: (value: SkillInventory) => void
    const cache = new SkillInventoryCache()
    const weakLoad = vi.fn(
      () =>
        new Promise<SkillInventory>((resolve) => {
          finishWeak = resolve
        }),
    )
    const weak = cache.get({ writeManifest: false }, weakLoad)
    const coalesced = cache.get({ writeManifest: false }, weakLoad)
    const strongInventory = inventory("strong")
    const strongLoad = vi.fn(async () => strongInventory)
    const strong = cache.get({ writeManifest: true }, strongLoad)

    expect(coalesced).toBe(weak)
    expect(await strong).toBe(strongInventory)
    finishWeak(inventory("weak"))
    await weak
    expect(await cache.get({ writeManifest: true }, strongLoad)).toBe(strongInventory)
    expect(weakLoad).toHaveBeenCalledTimes(1)
    expect(strongLoad).toHaveBeenCalledTimes(1)
  })

  it("forces a refresh before the TTL expires", async () => {
    const cache = new SkillInventoryCache()
    const load = vi.fn().mockResolvedValueOnce(inventory("first")).mockResolvedValueOnce(inventory("second"))

    await cache.get({ writeManifest: true }, load)
    const refreshed = await cache.refresh({ writeManifest: true }, load)

    expect(refreshed.updatedAt).toBe("second")
    expect(load).toHaveBeenCalledTimes(2)
  })
})
