import type { SettingsStore } from "./store.ts"

import { describe, expect, it, vi } from "vitest"
import { SettingsServiceImpl } from "./node.ts"

function settingsServiceWithPersisted(persisted: ReturnType<SettingsStore["read"]>) {
  const write = vi.fn()
  const store = {
    read: vi.fn(() => persisted),
    write,
  } as unknown as SettingsStore
  return { service: new SettingsServiceImpl({ store }), write }
}

describe("SettingsServiceImpl operating mode", () => {
  it("preserves an explicit unselected profile", () => {
    const { service } = settingsServiceWithPersisted({ operatingMode: "unselected" })
    expect(service.current().operatingMode).toBe("unselected")
  })

  it("keeps an absent legacy profile distinct from explicit unselected", () => {
    const { service } = settingsServiceWithPersisted({})
    expect(service.current().operatingMode).toBeNull()
  })

  it("persists an explicit unselected profile", async () => {
    const persisted = { themeSource: "dark" as const }
    const { service, write } = settingsServiceWithPersisted(persisted)

    await service.setOperatingMode("unselected")

    expect(write).toHaveBeenCalledWith({ ...persisted, operatingMode: "unselected" })
  })
})
