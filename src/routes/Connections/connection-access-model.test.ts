import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import {
  defaultRestrictedActionNames,
  unavailableActionNames,
  updateActionSelection,
} from "./connection-access-model.ts"

const actions: ConnectionActionCatalogItem[] = [
  action("list_issues", "read"),
  action("get_issue", "read"),
  action("create_issue", "write"),
  action("delete_issue", "destructive"),
]

describe("connection access action drafts", () => {
  it("starts a new restricted policy with known read actions", () => {
    expect(defaultRestrictedActionNames(actions)).toEqual(["get_issue", "list_issues"])
  })

  it("allows a restricted policy to remain explicitly empty", () => {
    expect(updateActionSelection(["get_issue", "list_issues"], ["get_issue", "list_issues"], false)).toEqual([])
  })

  it("preserves unavailable saved actions while editing a known group", () => {
    const selected = ["legacy_action", "list_issues"]

    expect(unavailableActionNames(selected, actions)).toEqual(["legacy_action"])
    expect(updateActionSelection(selected, ["get_issue", "list_issues"], false)).toEqual(["legacy_action"])
  })
})

function action(
  name: string,
  operationType: ConnectionActionCatalogItem["operationType"],
): ConnectionActionCatalogItem {
  return {
    description: `${name} description`,
    id: `github.${name}`,
    name,
    operationType,
    providerPermissions: [],
    requiredScopes: [],
    service: "github",
  }
}
