import type { AppUpdateState, AppUpdateStatus } from "../../electron/update/common.ts"

import { describe, expect, it } from "vitest"
import { resolveManualUpdateCheckAction, shouldStartManualUpdateCheck } from "./manual-update-check.ts"

function updateState(status: AppUpdateStatus, isPackaged = true): AppUpdateState {
  return {
    channel: "stable",
    currentVersion: "1.2.3",
    isPackaged,
    status,
  }
}

describe("resolveManualUpdateCheckAction", () => {
  it("starts a check from missing or idle state", () => {
    expect(resolveManualUpdateCheckAction(null)).toEqual({ type: "check" })
    expect(resolveManualUpdateCheckAction(updateState({ status: "idle" }))).toEqual({ type: "check" })
  })

  it("keeps active update work instead of starting a competing check", () => {
    expect(resolveManualUpdateCheckAction(updateState({ status: "checking" }))).toEqual({ type: "checking" })
    expect(resolveManualUpdateCheckAction(updateState({ status: "available", version: "1.3.0" }))).toEqual({
      type: "available",
      version: "1.3.0",
    })
    expect(resolveManualUpdateCheckAction(updateState({ status: "downloading", percent: 41.6 }))).toEqual({
      type: "downloading",
      percent: 42,
    })
    expect(resolveManualUpdateCheckAction(updateState({ status: "downloaded", version: "1.3.0" }))).toEqual({
      type: "downloaded",
      version: "1.3.0",
    })
  })

  it("reports completed and unavailable states", () => {
    expect(resolveManualUpdateCheckAction(updateState({ status: "not-available" }))).toEqual({
      type: "not-available",
      version: "1.2.3",
    })
    expect(resolveManualUpdateCheckAction(updateState({ status: "error", error: "offline" }))).toEqual({
      type: "error",
    })
    expect(resolveManualUpdateCheckAction(updateState({ status: "idle" }, false))).toEqual({ type: "unavailable" })
  })
})

describe("shouldStartManualUpdateCheck", () => {
  it("refreshes states that can contain a stale automatic-check result", () => {
    expect(shouldStartManualUpdateCheck(null)).toBe(true)
    expect(shouldStartManualUpdateCheck(updateState({ status: "idle" }))).toBe(true)
    expect(shouldStartManualUpdateCheck(updateState({ status: "not-available" }))).toBe(true)
    expect(shouldStartManualUpdateCheck(updateState({ status: "error", error: "offline" }))).toBe(true)
  })

  it("preserves actionable or in-progress update states", () => {
    expect(shouldStartManualUpdateCheck(updateState({ status: "checking" }))).toBe(false)
    expect(shouldStartManualUpdateCheck(updateState({ status: "available", version: "1.3.0" }))).toBe(false)
    expect(shouldStartManualUpdateCheck(updateState({ status: "downloading" }))).toBe(false)
    expect(shouldStartManualUpdateCheck(updateState({ status: "downloaded", version: "1.3.0" }))).toBe(false)
    expect(shouldStartManualUpdateCheck(updateState({ status: "idle" }, false))).toBe(false)
  })
})
