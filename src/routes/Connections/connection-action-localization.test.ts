import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import { localizeConnectionActions } from "./connection-action-localization.ts"

const actions = [
  {
    description: "List marketplaces.",
    id: "lingxing.list_marketplaces",
    name: "list_marketplaces",
    operationType: "read",
    service: "lingxing",
  },
] as ConnectionActionCatalogItem[]

describe("Connection Action localization", () => {
  it("localizes Lingxing descriptions without changing Action identity", () => {
    expect(localizeConnectionActions("lingxing", actions, "zh-CN")).toEqual([
      { ...actions[0], description: "列出领星 ERP 账号中配置的所有亚马逊站点。" },
    ])
  })

  it("preserves the source list outside Chinese Lingxing", () => {
    expect(localizeConnectionActions("lingxing", actions, "en")).toBe(actions)
    expect(localizeConnectionActions("github", actions, "zh-CN")).toBe(actions)
  })
})
