// @vitest-environment happy-dom

import type { SkillInventory, SkillVersionReport } from "../../../electron/skills/common.ts"
import type { useSkillService } from "@/components/AppContext"
import type { ResourceView } from "@/lib/resource-store"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useRegistrySkillUpdate } from "./use-registry-skill-update.ts"

const inventory: SkillInventory = {
  groups: [],
  summary: {
    localSkills: 0,
    managedSkills: 0,
    modifiedHosts: 0,
    needsAttention: 0,
    publishableSkills: 0,
    registrySkills: 0,
    sourceMissingHosts: 0,
    skills: [],
  },
  updatedAt: "2026-08-11T00:00:00.000Z",
}

const versionReport: SkillVersionReport = {
  checkedAt: "2026-08-11T00:00:00.000Z",
  cli: {
    command: [],
    status: "up-to-date",
  },
  skills: [],
  summary: {
    cliUpdates: 0,
    errors: 0,
    registrySkillUpdates: 0,
    totalUpdates: 0,
  },
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createResourceView<T>(overrides: Partial<ResourceView<T>> = {}): ResourceView<T> {
  return {
    data: null,
    error: null,
    invalidate: vi.fn(),
    isInitialLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
    status: "ready",
    updatedAt: null,
    ...overrides,
  } as ResourceView<T>
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("useRegistrySkillUpdate", () => {
  it("clears the updating state when installation finishes without waiting for version refresh", async () => {
    const update = createDeferred<SkillInventory>()
    const refresh = createDeferred<SkillVersionReport>()
    const inventoryResource = createResourceView<SkillInventory>()
    const versionResource = createResourceView<SkillVersionReport>({
      refresh: vi.fn(() => refresh.promise),
    })
    const skillService = {
      invoke: vi.fn(() => update.promise),
    } as unknown as ReturnType<typeof useSkillService>
    let updatePromise: Promise<void> | undefined

    function Harness() {
      const { updateRegistrySkill, updatingRegistrySkillId } = useRegistrySkillUpdate({
        inventoryResource,
        onError: vi.fn(),
        skillService,
        versionResource,
      })

      return React.createElement(
        "button",
        {
          "data-state": updatingRegistrySkillId ? "updating" : "idle",
          onClick: () => {
            updatePromise = updateRegistrySkill({ id: "oo-github", kind: "registry", packageName: "oo-github" })
          },
        },
        "Update",
      )
    }

    const host = document.createElement("div")
    document.body.append(host)
    const root: Root = createRoot(host)
    await act(async () => root.render(React.createElement(Harness)))
    const button = host.querySelector<HTMLButtonElement>("button")

    await act(async () => button?.click())
    expect(button?.dataset.state).toBe("updating")

    await act(async () => {
      update.resolve(inventory)
      await updatePromise
    })

    expect(button?.dataset.state).toBe("idle")
    expect(inventoryResource.setData).toHaveBeenCalledWith(inventory)
    expect(versionResource.invalidate).toHaveBeenCalledOnce()
    expect(versionResource.refresh).toHaveBeenCalledWith({ forceRefresh: true, silent: true })

    refresh.resolve(versionReport)
    await refresh.promise
    act(() => root.unmount())
  })
})
