import type { ModelCatalog } from "../../../electron/models/common.ts"

import { describe, expect, test } from "vitest"
import { modelCatalogForRuntime } from "./useModelCatalog.ts"

const catalog = {
  builtins: [{ id: "oopilot", displayName: "Auto" }],
  customModels: [{ id: "local-1", displayName: "Local 1" }],
  providers: [],
  selected: { kind: "builtin", id: "oopilot" },
} as unknown as ModelCatalog

describe("model catalog runtime projection", () => {
  test("hides cloud models and selects a custom fallback in local mode", () => {
    expect(modelCatalogForRuntime(catalog, false)).toMatchObject({
      builtins: [],
      selected: { kind: "custom", id: "local-1" },
    })
  })

  test("preserves the cloud catalog in OOMOL mode", () => {
    expect(modelCatalogForRuntime(catalog, true)).toBe(catalog)
  })
})
