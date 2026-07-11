import { describe, expect, it, vi } from "vitest"
import { AgentRetirementPool } from "./retirement.ts"

describe("AgentRetirementPool", () => {
  it("tracks a runtime until its disposal settles", async () => {
    let finish!: () => void
    const dispose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const pool = new AgentRetirementPool()

    const retirement = pool.retire({ dispose })
    await Promise.resolve()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pool.size).toBe(1)

    finish()
    await retirement

    expect(pool.size).toBe(0)
  })

  it("drains runtimes added while an earlier retirement is pending", async () => {
    let finishFirst!: () => void
    let finishSecond!: () => void
    const pool = new AgentRetirementPool()
    const firstRetirement = pool.retire({
      dispose: () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        }),
    })
    await Promise.resolve()

    const draining = pool.drain()
    pool.retire({
      dispose: () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve
        }),
    })
    await Promise.resolve()

    finishFirst()
    await firstRetirement
    expect(pool.size).toBe(1)

    finishSecond()
    await draining
    expect(pool.size).toBe(0)
  })

  it("continues draining when a disposal rejects", async () => {
    const pool = new AgentRetirementPool()
    void pool.retire({ dispose: () => Promise.reject(new Error("dispose failed")) }).catch(() => undefined)

    await expect(pool.drain()).resolves.toBeUndefined()
    expect(pool.size).toBe(0)
  })
})
