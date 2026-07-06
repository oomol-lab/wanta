import { describe, expect, it, vi } from "vitest"
import { terminateProcessTree } from "./sidecar.ts"

interface Recorder {
  killGroup: ReturnType<typeof vi.fn>
  killSelf: ReturnType<typeof vi.fn>
  scheduled: Array<{ fn: () => void; ms: number }>
}

function makeDeps(platform: NodeJS.Platform, overrides: Partial<Recorder> = {}) {
  const scheduled: Array<{ fn: () => void; ms: number }> = []
  const killGroup = overrides.killGroup ?? vi.fn()
  const killSelf = overrides.killSelf ?? vi.fn()
  return {
    scheduled,
    killGroup,
    killSelf,
    deps: {
      platform,
      killGroup: killGroup as unknown as (groupId: number, signal: NodeJS.Signals) => void,
      killSelf: killSelf as unknown as (signal: NodeJS.Signals) => void,
      schedule: (fn: () => void, ms: number) => scheduled.push({ fn, ms }),
    },
  }
}

describe("terminateProcessTree", () => {
  it("unix: SIGTERMs the whole process group then escalates to SIGKILL on the group", () => {
    const { deps, killGroup, killSelf, scheduled } = makeDeps("darwin")

    terminateProcessTree(4321, deps)

    // 组信号用负 pid 命中 opencode 及其后代。
    expect(killGroup).toHaveBeenCalledWith(-4321, "SIGTERM")
    expect(killSelf).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)

    scheduled[0].fn()
    expect(killGroup).toHaveBeenCalledWith(-4321, "SIGKILL")
    expect(killGroup).toHaveBeenCalledTimes(2)
  })

  it("unix: falls back to single-process kill when the group signal throws", () => {
    const killGroup = vi.fn((_groupId: number, signal: NodeJS.Signals) => {
      if (signal === "SIGTERM") {
        throw new Error("ESRCH")
      }
    })
    const { deps, killSelf, scheduled } = makeDeps("darwin", { killGroup })

    terminateProcessTree(99, deps)

    expect(killSelf).toHaveBeenCalledWith("SIGTERM")
    // 仍安排 SIGKILL 兜底，且其中的组信号异常被吞掉不抛。
    expect(scheduled).toHaveLength(1)
    expect(() => scheduled[0].fn()).not.toThrow()
  })

  it("win32: kills only the single process and schedules nothing", () => {
    const { deps, killGroup, killSelf, scheduled } = makeDeps("win32")

    terminateProcessTree(7, deps)

    expect(killSelf).toHaveBeenCalledWith("SIGTERM")
    expect(killGroup).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(0)
  })
})
