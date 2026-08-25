import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import {
  connectionAccessSaveDisabled,
  canRestoreConnectionAccess,
  createConnectionPermissionRuleGrant,
  defaultRestrictedActionNames,
  isConnectionAccessConflict,
  mergeConnectionRuleAssignments,
  unavailableActionNames,
  updateActionSelection,
} from "./connection-access-model.ts"

describe("connectionAccessSaveDisabled", () => {
  it("blocks catalog-dependent saves until the catalog finishes loading", () => {
    expect(
      connectionAccessSaveDisabled({ busy: false, dirty: true, error: false, loading: true, requiresCatalog: true }),
    ).toBe(true)
    expect(
      connectionAccessSaveDisabled({ busy: false, dirty: true, error: false, loading: false, requiresCatalog: true }),
    ).toBe(false)
  })

  it("allows catalog-independent modes but blocks every concurrent mutation", () => {
    expect(
      connectionAccessSaveDisabled({ busy: false, dirty: true, error: true, loading: true, requiresCatalog: false }),
    ).toBe(false)
    expect(
      connectionAccessSaveDisabled({ busy: true, dirty: true, error: false, loading: false, requiresCatalog: false }),
    ).toBe(true)
  })
})

const actions: ConnectionActionCatalogItem[] = [
  action("list_issues", "read"),
  action("get_issue", "read"),
  action("create_issue", "write"),
  action("delete_issue", "destructive"),
]

describe("connection access action drafts", () => {
  it("starts a new permission rule denied by default", () => {
    expect(createConnectionPermissionRuleGrant()).toEqual({
      actionAccess: { actionNames: [], mode: "restricted" },
    })
  })

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

describe("connection access recovery", () => {
  it("offers recovery to managers for configured and invalid policies", () => {
    expect(
      canRestoreConnectionAccess(true, {
        appId: "app-github",
        issues: [],
        mode: "invalid",
        service: "github",
      }),
    ).toBe(true)
    expect(
      canRestoreConnectionAccess(true, {
        appId: "app-github",
        format: "multi",
        mode: "configured",
        permissionRules: { assignments: {}, rules: [], teamDefault: { actionAccess: { mode: "unrestricted" } } },
        service: "github",
      }),
    ).toBe(true)
  })

  it("does not offer recovery to ordinary members or unconfigured Apps", () => {
    expect(
      canRestoreConnectionAccess(false, {
        appId: "app-github",
        issues: [],
        mode: "invalid",
        service: "github",
      }),
    ).toBe(false)
    expect(
      canRestoreConnectionAccess(true, {
        appId: "app-github",
        mode: "default",
        permissionRules: { assignments: {}, rules: [], teamDefault: { actionAccess: { mode: "unrestricted" } } },
        service: "github",
      }),
    ).toBe(false)
  })
})

describe("connection access concurrency", () => {
  it("recognizes an ETag precondition conflict", () => {
    expect(isConnectionAccessConflict({ status: 412 })).toBe(true)
    expect(isConnectionAccessConflict({ status: 409 })).toBe(false)
    expect(isConnectionAccessConflict(new Error("HTTP 412"))).toBe(false)
  })
})

describe("connection rule assignments", () => {
  it("preserves assignments for users outside the loaded member list", () => {
    expect(
      mergeConnectionRuleAssignments(
        {
          "loaded-kept": "other-rule",
          "loaded-moved": "other-rule",
          "loaded-removed": "edited-rule",
          "outside-kept": "edited-rule",
        },
        "edited-rule",
        ["loaded-moved"],
        ["loaded-kept", "loaded-moved", "loaded-removed"],
      ),
    ).toEqual({
      "loaded-kept": "other-rule",
      "loaded-moved": "edited-rule",
      "outside-kept": "edited-rule",
    })
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
