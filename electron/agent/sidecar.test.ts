import type { ProcessSnapshotEntry } from "./sidecar.ts"

import { describe, expect, it } from "vitest"
import {
  collectDescendantTree,
  distinctProcessGroups,
  OpencodeSidecar,
  parsePsSnapshot,
  reapProcessTree,
  reapWindowsProcessTree,
} from "./sidecar.ts"

describe("OpencodeSidecar", () => {
  it("returns the same disposal promise to every caller", () => {
    const sidecar = new OpencodeSidecar({
      config: {},
      env: {},
      isolationDir: "/tmp/wanta-sidecar-test-isolation",
      opencodeBinPath: "/tmp/wanta-sidecar-test-opencode",
      workspaceDir: "/tmp/wanta-sidecar-test-workspace",
    })

    const first = sidecar.dispose()
    const second = sidecar.dispose()

    expect(second).toBe(first)
  })
})

// opencode(100) -> bash 工具子进程(200，自成 session/组) -> 其子(300，与 bash 同组)；
// 另有无关进程 999。opencode 的工具子进程 setsid 逃逸出 opencode 的进程组，是"正在后台运行"孤儿的根源。
const SNAPSHOT: ProcessSnapshotEntry[] = [
  { pid: 50, ppid: 1, pgid: 50 },
  { pid: 100, ppid: 50, pgid: 100 },
  { pid: 200, ppid: 100, pgid: 200 },
  { pid: 300, ppid: 200, pgid: 200 },
  { pid: 999, ppid: 1, pgid: 999 },
]

describe("parsePsSnapshot", () => {
  it("parses pid/ppid/pgid rows and skips junk lines", () => {
    const stdout = ["  100   50  100", "200 100 200", "", "header garbage", "  x y z  ", "300 200 200"].join("\n")
    expect(parsePsSnapshot(stdout)).toEqual([
      { pid: 100, ppid: 50, pgid: 100 },
      { pid: 200, ppid: 100, pgid: 200 },
      { pid: 300, ppid: 200, pgid: 200 },
    ])
  })
})

describe("collectDescendantTree", () => {
  it("collects the whole ppid subtree with root first", () => {
    const tree = collectDescendantTree(100, SNAPSHOT)
    expect(tree[0]).toBe(100)
    expect([...tree].sort((a, b) => a - b)).toEqual([100, 200, 300])
    expect(tree).not.toContain(999)
    expect(tree).not.toContain(50)
  })

  it("returns just the root when it has no descendants", () => {
    expect(collectDescendantTree(999, SNAPSHOT)).toEqual([999])
  })

  it("is resilient to a ppid cycle", () => {
    const cyclic: ProcessSnapshotEntry[] = [
      { pid: 1, ppid: 2, pgid: 1 },
      { pid: 2, ppid: 1, pgid: 2 },
    ]
    expect(collectDescendantTree(1, cyclic).sort((a, b) => a - b)).toEqual([1, 2])
  })
})

describe("distinctProcessGroups", () => {
  it("includes only groups whose leader is inside the tree", () => {
    const pids = collectDescendantTree(100, SNAPSHOT)
    expect(distinctProcessGroups(pids, SNAPSHOT).sort((a, b) => a - b)).toEqual([100, 200])
  })

  it("excludes groups led by a process outside the tree and pgid<=1", () => {
    const snapshot: ProcessSnapshotEntry[] = [
      { pid: 100, ppid: 50, pgid: 100 },
      { pid: 400, ppid: 100, pgid: 7 }, // 组长 7 不在树内 -> 排除
      { pid: 500, ppid: 100, pgid: 1 }, // pgid<=1 -> 排除
    ]
    expect(distinctProcessGroups([100, 400, 500], snapshot)).toEqual([100])
  })
})

interface KillCall {
  target: number
  signal: NodeJS.Signals
}

function makeReaper(overrides: {
  snapshot?: ProcessSnapshotEntry[]
  alivePids?: Set<number>
  snapshotRejects?: boolean
}) {
  const calls: KillCall[] = []
  const alive = overrides.alivePids
  return {
    calls,
    deps: {
      snapshot: overrides.snapshotRejects
        ? () => Promise.reject(new Error("ps failed"))
        : () => Promise.resolve(overrides.snapshot ?? SNAPSHOT),
      kill: (target: number, signal: NodeJS.Signals) => {
        calls.push({ target, signal })
      },
      isAlive: (pid: number) => (alive ? alive.has(pid) : false),
      delay: () => Promise.resolve(),
      graceMs: 300,
      pollMs: 100,
    },
  }
}

describe("reapWindowsProcessTree", () => {
  it("runs taskkill /PID <pid> /T /F to kill the whole subtree", async () => {
    const runs: Array<{ command: string; args: string[] }> = []
    await reapWindowsProcessTree(4321, (command, args) => {
      runs.push({ command, args })
      return Promise.resolve()
    })
    expect(runs).toEqual([{ command: "taskkill", args: ["/PID", "4321", "/T", "/F"] }])
  })

  it("swallows taskkill errors (process already gone)", async () => {
    await expect(reapWindowsProcessTree(7, () => Promise.reject(new Error("not found")))).resolves.toBeUndefined()
  })
})

describe("reapProcessTree", () => {
  it("unix: SIGTERMs every group and pid, and skips SIGKILL once the tree is gone", async () => {
    const { calls, deps } = makeReaper({ alivePids: new Set() }) // nothing alive after SIGTERM
    await reapProcessTree(100, deps)
    expect(calls.filter((c) => c.signal === "SIGKILL")).toHaveLength(0)
    expect(calls).toContainEqual({ target: -100, signal: "SIGTERM" })
    expect(calls).toContainEqual({ target: -200, signal: "SIGTERM" })
    for (const pid of [100, 200, 300]) {
      expect(calls).toContainEqual({ target: pid, signal: "SIGTERM" })
    }
  })

  it("unix: escalates to SIGKILL on groups and pids when survivors persist", async () => {
    const { calls, deps } = makeReaper({ alivePids: new Set([100, 200, 300]) }) // never die
    await reapProcessTree(100, deps)
    expect(calls).toContainEqual({ target: -100, signal: "SIGKILL" })
    expect(calls).toContainEqual({ target: -200, signal: "SIGKILL" })
    for (const pid of [100, 200, 300]) {
      expect(calls).toContainEqual({ target: pid, signal: "SIGKILL" })
    }
  })

  it("unix: falls back to the root pid and its own process group when the ps snapshot fails", async () => {
    const { calls, deps } = makeReaper({ snapshotRejects: true, alivePids: new Set() })
    await reapProcessTree(100, deps)
    // 降级：至少回收 root 自身进程（正）与其进程组（负，detached 下 pgid===pid）。
    expect(calls).toContainEqual({ target: 100, signal: "SIGTERM" })
    expect(calls).toContainEqual({ target: -100, signal: "SIGTERM" })
    expect(calls.every((c) => Math.abs(c.target) === 100)).toBe(true)
  })
})
