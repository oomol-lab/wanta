import { describe, expect, it } from "vitest"
import { legacyOperatingMode, operatingModeGateLoading, operatingProfileTarget } from "./operating-profile.ts"

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
  })

  it("maps each persisted mode to its complete Link runtime", () => {
    expect(operatingProfileTarget(false, "oomol")).toEqual({ linkRuntime: "oomol", mode: "oomol" })
    expect(operatingProfileTarget(false, "self-managed")).toEqual({
      linkRuntime: "openconnector",
      mode: "self-managed",
    })
  })

  it("treats an explicit OOMOL sign-in as selecting the OOMOL profile", () => {
    expect(operatingProfileTarget(true, "self-managed")).toEqual({ linkRuntime: "oomol", mode: "oomol" })
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
