import type { PublicSkillPackage } from "../../../electron/skills/common.ts"

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  clearProviderSkillPackageLookupCacheForTest,
  readProviderSkillPackage,
} from "./provider-skill-package-lookup.ts"
import { readPublicSkillPackageByName, searchPublicSkillPackages } from "@/lib/skills-catalog-client"

vi.mock("@/lib/skills-catalog-client", () => ({
  readPublicSkillPackageByName: vi.fn(),
  searchPublicSkillPackages: vi.fn(),
}))

const posthogPackage: PublicSkillPackage = {
  displayName: "PostHog",
  id: "oo-posthog",
  isTemplate: false,
  maintainers: [{ name: "OOMOL" }],
  name: "oo-posthog",
  skills: [{ name: "posthog", title: "PostHog" }],
  version: "1.0.0",
  visibility: "public",
}

describe("provider Skill package lookup", () => {
  beforeEach(() => {
    clearProviderSkillPackageLookupCacheForTest()
    vi.mocked(readPublicSkillPackageByName).mockReset()
    vi.mocked(searchPublicSkillPackages).mockReset()
  })

  afterEach(() => {
    clearProviderSkillPackageLookupCacheForTest()
  })

  test("shares in-flight package requests for the same provider", async () => {
    let resolvePackage: (pkg: PublicSkillPackage) => void = () => undefined
    vi.mocked(readPublicSkillPackageByName).mockReturnValueOnce(
      new Promise<PublicSkillPackage>((resolve) => {
        resolvePackage = resolve
      }),
    )

    const candidate = { providerDisplayName: "PostHog", service: "posthog" }
    const first = readProviderSkillPackage(candidate)
    const second = readProviderSkillPackage(candidate)

    expect(readPublicSkillPackageByName).toHaveBeenCalledTimes(1)
    resolvePackage(posthogPackage)

    await expect(first).resolves.toBe(posthogPackage)
    await expect(second).resolves.toBe(posthogPackage)
  })

  test("retries after a failed in-flight package request", async () => {
    vi.mocked(readPublicSkillPackageByName).mockResolvedValue(null)
    vi.mocked(searchPublicSkillPackages)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ items: [posthogPackage], next: null, updatedAt: "2026-07-08T00:00:00Z" })

    const candidate = { providerDisplayName: "PostHog", service: "posthog" }

    await expect(readProviderSkillPackage(candidate)).rejects.toThrow("temporary failure")
    await expect(readProviderSkillPackage(candidate)).resolves.toBe(posthogPackage)
    expect(searchPublicSkillPackages).toHaveBeenCalledTimes(2)
  })
})
