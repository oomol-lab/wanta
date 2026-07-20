import { describe, expect, it } from "vitest"
import {
  betaUpdateCheckIntervalMs,
  foregroundUpdateCheckTtlMs,
  hasRecentSuccessfulCheck,
  jitteredUpdateCheckIntervalMs,
  randomDelayMs,
  shouldCheckAfterForeground,
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

  it("checks after resume when the 30 minute freshness window expired", () => {
    const now = Date.parse("2026-07-11T12:00:00.000Z")
    expect(shouldCheckAfterResume(undefined, now)).toBe(true)
    expect(shouldCheckAfterResume("invalid", now)).toBe(true)
    expect(shouldCheckAfterResume(new Date(now - foregroundUpdateCheckTtlMs + 1).toISOString(), now)).toBe(false)
    expect(shouldCheckAfterResume(new Date(now - foregroundUpdateCheckTtlMs).toISOString(), now)).toBe(true)
  })

  it("uses the same freshness window when the app returns to the foreground", () => {
    const now = Date.parse("2026-07-11T12:00:00.000Z")
    expect(shouldCheckAfterForeground(new Date(now - foregroundUpdateCheckTtlMs + 1).toISOString(), now)).toBe(false)
    expect(shouldCheckAfterForeground(new Date(now - foregroundUpdateCheckTtlMs).toISOString(), now)).toBe(true)
  })

  it("suppresses scheduled checks immediately after another successful check", () => {
    const now = Date.parse("2026-07-11T12:00:00.000Z")
    expect(hasRecentSuccessfulCheck(new Date(now - 59_999).toISOString(), now)).toBe(true)
    expect(hasRecentSuccessfulCheck(new Date(now - 60_000).toISOString(), now)).toBe(false)
    expect(hasRecentSuccessfulCheck(undefined, now)).toBe(false)
  })
})
