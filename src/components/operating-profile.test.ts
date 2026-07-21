import { describe, expect, it } from "vitest"
import {
  initialSetupRequired,
  legacyOperatingMode,
  operatingModeAfterSignOut,
  operatingModeGateLoading,
  operatingProfileTarget,
} from "./operating-profile.ts"

describe("operatingModeGateLoading", () => {
  const readyState = {
    authenticated: false,
    linkRuntimeLoading: false,
    modelCatalogAvailable: true,
    modelCatalogFailed: false,
    operatingMode: "self-managed" as const,
    settingsLoading: false,
  }

  it("waits while the model catalog is still loading", () => {
    expect(operatingModeGateLoading({ ...readyState, modelCatalogAvailable: false })).toBe(true)
  })

  it("does not leave the app blank after model catalog loading fails", () => {
    expect(operatingModeGateLoading({ ...readyState, modelCatalogAvailable: false, modelCatalogFailed: true })).toBe(
      false,
    )
  })
})

describe("operatingProfileTarget", () => {
  it("keeps an unconfigured signed-out user in initial setup", () => {
    expect(operatingProfileTarget(false, null)).toBeNull()
    expect(operatingProfileTarget(false, "unselected")).toBeNull()
  })

  it("gives an authenticated legacy session an explicit profile to persist", () => {
    expect(operatingProfileTarget(true, null)).toEqual({ linkRuntime: "oomol", mode: "oomol" })
  })

  it("does not let a signed-out Wanta profile fall through to the application", () => {
    expect(operatingProfileTarget(false, "oomol")).toBeNull()
  })

  it("maps the persisted self-managed mode to its complete Link runtime", () => {
    expect(operatingProfileTarget(false, "self-managed")).toEqual({
      linkRuntime: "openconnector",
      mode: "self-managed",
    })
  })

  it("treats an explicit OOMOL sign-in as selecting the OOMOL profile", () => {
    expect(operatingProfileTarget(true, "self-managed")).toEqual({ linkRuntime: "oomol", mode: "oomol" })
  })
})

describe("initialSetupRequired", () => {
  it("returns signed-out Wanta users and explicit unselected users to setup", () => {
    expect(initialSetupRequired(false, "oomol")).toBe(true)
    expect(initialSetupRequired(false, "unselected")).toBe(true)
    expect(initialSetupRequired(false, null)).toBe(true)
  })

  it("keeps an explicitly self-managed user in the application", () => {
    expect(initialSetupRequired(false, "self-managed")).toBe(false)
  })

  it("does not interrupt an authenticated session while its profile synchronizes", () => {
    expect(initialSetupRequired(true, null)).toBe(false)
    expect(initialSetupRequired(true, "unselected")).toBe(false)
  })
})

describe("operatingModeAfterSignOut", () => {
  it("returns Wanta users to an explicit unselected state", () => {
    expect(operatingModeAfterSignOut("oomol")).toBe("unselected")
  })

  it("preserves an explicitly selected self-managed profile", () => {
    expect(operatingModeAfterSignOut("self-managed")).toBe("self-managed")
  })

  it("does not turn legacy first-run state into self-managed mode", () => {
    expect(operatingModeAfterSignOut(null)).toBeNull()
    expect(operatingModeAfterSignOut("unselected")).toBe("unselected")
  })
})

describe("legacyOperatingMode", () => {
  it("migrates only a complete signed-out self-managed configuration", () => {
    const linkRuntime = {
      active: "openconnector" as const,
      availability: { oomol: false, openconnector: true },
      selected: "openconnector" as const,
    }
    expect(legacyOperatingMode({ authenticated: false, hasCustomModel: true, linkRuntime })).toBe("self-managed")
    expect(legacyOperatingMode({ authenticated: false, hasCustomModel: false, linkRuntime })).toBeNull()
    expect(legacyOperatingMode({ authenticated: true, hasCustomModel: true, linkRuntime })).toBeNull()
  })
})
