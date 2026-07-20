import type { UpdateChannel } from "./channel.ts"

export const stableUpdateCheckIntervalMs = 2 * 60 * 60 * 1_000
export const betaUpdateCheckIntervalMs = 60 * 60 * 1_000
export const startupUpdateCheckDelayRangeMs = { max: 15_000, min: 5_000 } as const
export const resumeUpdateCheckDelayRangeMs = { max: 30_000, min: 10_000 } as const
export const foregroundUpdateCheckDelayRangeMs = { max: 10_000, min: 3_000 } as const
export const foregroundUpdateCheckTtlMs = 30 * 60 * 1_000
export const resumeUpdateCheckTtlMs = 30 * 60 * 1_000
export const minimumScheduledCheckSpacingMs = 60_000
export const updateCheckJitterRatio = 0.125

export function updateCheckIntervalMs(channel: UpdateChannel): number {
  return channel === "beta" ? betaUpdateCheckIntervalMs : stableUpdateCheckIntervalMs
}

export function randomDelayMs(min: number, max: number, random: number): number {
  const boundedRandom = Math.min(1, Math.max(0, random))
  return Math.round(min + (max - min) * boundedRandom)
}

export function jitteredUpdateCheckIntervalMs(channel: UpdateChannel, random: number): number {
  const interval = updateCheckIntervalMs(channel)
  const boundedRandom = Math.min(1, Math.max(0, random))
  return Math.round(interval * (1 - updateCheckJitterRatio + boundedRandom * updateCheckJitterRatio * 2))
}

export function shouldCheckAfterResume(checkedAt: string | undefined, nowMs: number): boolean {
  return shouldCheckAfterTtl(checkedAt, nowMs, resumeUpdateCheckTtlMs)
}

export function shouldCheckAfterForeground(checkedAt: string | undefined, nowMs: number): boolean {
  return shouldCheckAfterTtl(checkedAt, nowMs, foregroundUpdateCheckTtlMs)
}

export function hasRecentSuccessfulCheck(checkedAt: string | undefined, nowMs: number): boolean {
  return !shouldCheckAfterTtl(checkedAt, nowMs, minimumScheduledCheckSpacingMs)
}

function shouldCheckAfterTtl(checkedAt: string | undefined, nowMs: number, ttlMs: number): boolean {
  if (!checkedAt) return true
  const checkedAtMs = Date.parse(checkedAt)
  return !Number.isFinite(checkedAtMs) || nowMs - checkedAtMs >= ttlMs
}
