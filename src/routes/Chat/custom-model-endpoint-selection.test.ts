import type { CustomModelProvider } from "../../../electron/models/common.ts"

import { describe, expect, it } from "vitest"
import { customModelEndpointSelectionForBaseUrl } from "./custom-model-endpoint-selection.ts"

const provider: CustomModelProvider = {
  id: "provider",
  displayName: "Provider",
  baseUrl: "https://default.example.test/v1",
  apiPlans: [
    {
      id: "standard",
      baseUrl: "https://standard.example.test/v1",
      apiRegions: [
        { id: "global", baseUrl: "https://global.example.test/v1" },
        { id: "cn", baseUrl: "https://cn.example.test/v1" },
      ],
    },
    { id: "coding", baseUrl: "https://coding.example.test/v1" },
  ],
}

describe("customModelEndpointSelectionForBaseUrl", () => {
  it("restores the plan and region represented by a saved base URL", () => {
    expect(customModelEndpointSelectionForBaseUrl(provider, "https://cn.example.test/v1")).toEqual({
      apiPlanId: "standard",
      apiRegionId: "cn",
    })
  })

  it("restores a plan without regions from its endpoint", () => {
    expect(customModelEndpointSelectionForBaseUrl(provider, "https://coding.example.test/v1")).toEqual({
      apiPlanId: "coding",
      apiRegionId: "",
    })
  })

  it("leaves unmatched custom endpoints to the caller's default selection", () => {
    expect(customModelEndpointSelectionForBaseUrl(provider, "https://custom.example.test/v1")).toBeNull()
  })
})
