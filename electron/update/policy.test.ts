import { describe, expect, it } from "vitest"
import {
  betaUpdateCheckIntervalMs,
  jitteredUpdateCheckIntervalMs,
  randomDelayMs,
  shouldCheckAfterResume,
  stableUpdateCheckIntervalMs,
  updateCheckIntervalMs,
  updateCheckJitterRatio,
} from "./policy.ts"

describe("update policy", () => {
  it("uses a shorter cadence for beta builds", () => {
    expect(updateCheckIntervalMs("stable")).toBe(stableUpdateCheckIntervalMs)
    expect(updateCheckIntervalMs("beta")).toBe(betaUpdateCheckIntervalMs)
  })

  it("adds bounded symmetric jitter to periodic checks", () => {
    expect(jitteredUpdateCheckIntervalMs("stable", 0)).toBe(stableUpdateCheckIntervalMs * (1 - updateCheckJitterRatio))
    expect(jitteredUpdateCheckIntervalMs("stable", 0.5)).toBe(stableUpdateCheckIntervalMs)
    expect(jitteredUpdateCheckIntervalMs("stable", 1)).toBe(stableUpdateCheckIntervalMs * (1 + updateCheckJitterRatio))
  })

  it("bounds random delays defensively", () => {
    expect(randomDelayMs(10, 20, -1)).toBe(10)
    expect(randomDelayMs(10, 20, 0.5)).toBe(15)
    expect(randomDelayMs(10, 20, 2)).toBe(20)
  })

  it("checks after resume only when the channel TTL expired", () => {
    const now = Date.parse("2026-07-11T12:00:00.000Z")
    expect(shouldCheckAfterResume(undefined, now, "stable")).toBe(true)
    expect(shouldCheckAfterResume("invalid", now, "stable")).toBe(true)
    expect(shouldCheckAfterResume("2026-07-11T09:00:01.000Z", now, "stable")).toBe(false)
    expect(shouldCheckAfterResume("2026-07-11T08:00:00.000Z", now, "stable")).toBe(true)
    expect(shouldCheckAfterResume("2026-07-11T10:00:00.000Z", now, "beta")).toBe(true)
  })
})
