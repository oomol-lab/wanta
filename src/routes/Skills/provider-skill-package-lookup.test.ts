import type { PublicSkillPackage } from "../../../electron/skills/common.ts"

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { clearProviderSkillPackageCache, readProviderSkillPackage } from "./provider-skill-package-lookup.ts"
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
    clearProviderSkillPackageCache()
    vi.mocked(readPublicSkillPackageByName).mockReset()
    vi.mocked(searchPublicSkillPackages).mockReset()
  })

  afterEach(() => {
    clearProviderSkillPackageCache()
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

  test("stops fallback searches after a high-confidence package match", async () => {
    vi.mocked(readPublicSkillPackageByName).mockResolvedValue(null)
    vi.mocked(searchPublicSkillPackages).mockResolvedValue({
      items: [posthogPackage],
      next: null,
      updatedAt: "2026-07-10T00:00:00Z",
    })

    await expect(readProviderSkillPackage({ providerDisplayName: "PostHog", service: "posthog" })).resolves.toBe(
      posthogPackage,
    )

    expect(searchPublicSkillPackages).toHaveBeenCalledTimes(1)
    expect(searchPublicSkillPackages).toHaveBeenCalledWith({ query: "PostHog", size: 12 })
  })

  test("propagates cancellation without starting fallback searches", async () => {
    const controller = new AbortController()
    const cancellation = new Error("Provider Skill lookup was cancelled.")
    vi.mocked(readPublicSkillPackageByName).mockImplementationOnce(async () => {
      controller.abort(cancellation)
      throw cancellation
    })

    await expect(
      readProviderSkillPackage({ providerDisplayName: "PostHog", service: "posthog" }, controller.signal),
    ).rejects.toBe(cancellation)

    expect(searchPublicSkillPackages).not.toHaveBeenCalled()
  })
})
