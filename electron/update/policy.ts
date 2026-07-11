import type { UpdateChannel } from "./channel.ts"

export const stableUpdateCheckIntervalMs = 4 * 60 * 60 * 1_000
export const betaUpdateCheckIntervalMs = 2 * 60 * 60 * 1_000
export const startupUpdateCheckDelayRangeMs = { max: 45_000, min: 15_000 } as const
export const resumeUpdateCheckDelayRangeMs = { max: 90_000, min: 30_000 } as const
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

export function shouldCheckAfterResume(checkedAt: string | undefined, nowMs: number, channel: UpdateChannel): boolean {
  if (!checkedAt) {
    return true
  }
  const checkedAtMs = Date.parse(checkedAt)
  return !Number.isFinite(checkedAtMs) || nowMs - checkedAtMs >= updateCheckIntervalMs(channel)
}
