import type { SettingsStore } from "./store.ts"

import { describe, expect, it, vi } from "vitest"
import { SettingsServiceImpl } from "./node.ts"

function settingsServiceWithPersisted(persisted: ReturnType<SettingsStore["read"]>): SettingsServiceImpl {
  const store = {
    read: vi.fn(() => persisted),
    write: vi.fn(),
  } as unknown as SettingsStore
  return new SettingsServiceImpl({ store })
}

describe("SettingsServiceImpl operating mode", () => {
  it("preserves an explicit unselected profile", () => {
    expect(settingsServiceWithPersisted({ operatingMode: "unselected" }).current().operatingMode).toBe("unselected")
  })

  it("keeps an absent legacy profile distinct from explicit unselected", () => {
    expect(settingsServiceWithPersisted({}).current().operatingMode).toBeNull()
  })
})
