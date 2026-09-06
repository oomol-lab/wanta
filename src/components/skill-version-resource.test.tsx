// @vitest-environment happy-dom
import type { SkillVersionReport } from "../../electron/skills/common.ts"
import type { AppDataResources } from "./AppDataContext"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { AppDataContext } from "./AppDataContext"
import { useSkillVersionReportResource } from "./AppDataHooks"
import { createResource } from "@/lib/resource-store"

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.unstubAllGlobals()
})

const report: SkillVersionReport = {
  checkedAt: "now",
  cli: { command: [], status: "up-to-date" },
  skills: [],
  summary: { cliUpdates: 0, errors: 0, registrySkillUpdates: 0, totalUpdates: 0 },
}

async function mount(load: () => Promise<SkillVersionReport>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const skillVersions = createResource({ load, staleTimeMs: 30 * 60_000 })
  const resources = { skillVersions } as AppDataResources
  function Probe({ autoLoad }: { autoLoad: boolean }) {
    useSkillVersionReportResource({ autoLoad })
    return null
  }
  root = createRoot(document.createElement("div"))
  const render = async (autoLoad: boolean) => {
    await act(async () =>
      root!.render(
        <AppDataContext.Provider value={resources}>
          <Probe autoLoad={autoLoad} />
        </AppDataContext.Provider>,
      ),
    )
  }
  await render(true)
  return { skillVersions, render }
}

test("visible version reports reload after each invalidation and reuse fresh data otherwise", async () => {
  const load = vi.fn(async () => report)
  const probe = await mount(load)
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => probe.skillVersions.invalidate())
  expect(load).toHaveBeenCalledTimes(2)
  await probe.render(true)
  expect(load).toHaveBeenCalledTimes(2)
  await probe.render(false)
  await act(async () => probe.skillVersions.invalidate())
  expect(load).toHaveBeenCalledTimes(2)
  await probe.render(true)
  expect(load).toHaveBeenCalledTimes(3)
})

test("failed initial version checks do not create an automatic retry loop", async () => {
  const load = vi.fn<() => Promise<SkillVersionReport>>(async () => {
    throw new Error("offline")
  })
  const probe = await mount(load)
  expect(load).toHaveBeenCalledTimes(1)
  expect(probe.skillVersions.getSnapshot().status).toBe("error")
  await act(async () => probe.skillVersions.invalidate())
  expect(load).toHaveBeenCalledTimes(2)
  await probe.render(false)
  load.mockResolvedValue(report)
  await probe.render(true)
  expect(load).toHaveBeenCalledTimes(3)
  expect(probe.skillVersions.getSnapshot().status).toBe("ready")
})

test("invalidation during a silent refresh starts a replacement and rejects stale writes", async () => {
  let resolveOld!: (value: SkillVersionReport) => void
  const load = vi.fn(async () => report)
  const probe = await mount(load)
  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  await act(async () => probe.skillVersions.invalidate())
  expect(load).toHaveBeenCalledTimes(2)
  await act(async () => probe.skillVersions.invalidate())
  expect(load).toHaveBeenCalledTimes(3)
  await act(async () => resolveOld({ ...report, checkedAt: "stale" }))
  expect(probe.skillVersions.getSnapshot().data?.checkedAt).toBe("now")
})
