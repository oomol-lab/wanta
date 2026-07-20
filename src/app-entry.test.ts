import { describe, expect, test } from "vitest"
import { resolveAppEntryState } from "./app-entry.ts"

describe("app entry", () => {
  test("enters the app once auth and runtime facts are initialized", () => {
    expect(resolveAppEntryState({ authReady: true, runtimeFailed: false, runtimeReady: true })).toBe("app")
  })

  test("waits for both initialization sources without requiring authentication", () => {
    expect(resolveAppEntryState({ authReady: false, runtimeFailed: false, runtimeReady: true })).toBe("loading")
    expect(resolveAppEntryState({ authReady: true, runtimeFailed: false, runtimeReady: false })).toBe("loading")
  })

  test("shows recovery UI when runtime capability loading fails", () => {
    expect(resolveAppEntryState({ authReady: true, runtimeFailed: true, runtimeReady: false })).toBe("fallback")
  })
})
