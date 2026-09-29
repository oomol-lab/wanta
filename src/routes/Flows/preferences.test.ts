import { afterEach, expect, it, vi } from "vitest"
import { createFlowPreferences, flowScopeKey } from "./preferences.ts"

afterEach(() => vi.unstubAllGlobals())

it("isolates persisted preferences by deployment, account and team", () => {
  const values = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  const first = createFlowPreferences(flowScopeKey("account-a", "team-a"))
  first.setItem("layout", "wide")
  expect(createFlowPreferences(flowScopeKey("account-a", "team-a")).getItem("layout")).toBe("wide")
  expect(createFlowPreferences(flowScopeKey("account-b", "team-a")).getItem("layout")).toBeNull()
  expect(createFlowPreferences(flowScopeKey("account-a", "team-b")).getItem("layout")).toBeNull()
})

it("keeps preferences working when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("Unavailable")
    },
    setItem: () => {
      throw Error("Unavailable")
    },
  })
  const preferences = createFlowPreferences("scope")
  expect(preferences.getItem("layout")).toBeNull()
  preferences.setItem("layout", "wide")
  expect(preferences.getItem("layout")).toBe("wide")
})
