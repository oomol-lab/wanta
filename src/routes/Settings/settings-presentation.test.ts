import { describe, expect, it } from "vitest"
import { shouldShowSelfManagedRuntimeSettings } from "./settings-presentation.ts"

describe("shouldShowSelfManagedRuntimeSettings", () => {
  it("shows local model and OpenConnector settings only when signed out", () => {
    expect(shouldShowSelfManagedRuntimeSettings("unauthenticated")).toBe(true)
    expect(shouldShowSelfManagedRuntimeSettings("authenticated")).toBe(false)
  })

  it("keeps self-managed settings hidden while authentication is loading", () => {
    expect(shouldShowSelfManagedRuntimeSettings(undefined)).toBe(false)
  })
})
