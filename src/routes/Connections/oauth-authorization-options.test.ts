import type { ConnectionOAuthAuthorizationOption } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import {
  createInitialOAuthAuthorizationOptionIds,
  getOAuthAuthorizationOptionChanges,
  isOAuthAuthorizationOptionLocked,
  updateOAuthAuthorizationOptionIds,
} from "./oauth-authorization-options.ts"

const options: ConnectionOAuthAuthorizationOption[] = [
  {
    defaultSelected: false,
    description: "Read account details.",
    id: "account.read",
    label: "Account",
    required: true,
    requires: [],
    risk: "standard",
  },
  {
    defaultSelected: true,
    description: "Read documents.",
    id: "documents.read",
    label: "Read documents",
    required: false,
    requires: ["account.read"],
    risk: "standard",
  },
  {
    defaultSelected: false,
    description: "Delete documents.",
    id: "documents.delete",
    label: "Delete documents",
    required: false,
    requires: ["documents.read"],
    risk: "destructive",
  },
]

describe("OAuth authorization option state", () => {
  it("selects required and default options with their dependencies", () => {
    expect(createInitialOAuthAuthorizationOptionIds(options)).toEqual(["account.read", "documents.read"])
  })

  it("restores current scopes while always retaining required options", () => {
    expect(createInitialOAuthAuthorizationOptionIds(options, ["documents.delete"])).toEqual([
      "account.read",
      "documents.read",
      "documents.delete",
    ])
  })

  it("adds dependencies and prevents selected dependants from losing them", () => {
    const selected = updateOAuthAuthorizationOptionIds(options, ["account.read"], "documents.delete", true)
    expect(selected).toEqual(["account.read", "documents.read", "documents.delete"])
    expect(isOAuthAuthorizationOptionLocked(options, selected, "documents.read")).toBe(true)
    expect(updateOAuthAuthorizationOptionIds(options, selected, "documents.read", false)).toEqual(selected)
  })

  it("reports authorization changes for reconnect", () => {
    expect(getOAuthAuthorizationOptionChanges(["account.read", "documents.read"], ["account.read"])).toEqual({
      added: [],
      removed: ["documents.read"],
    })
  })
})
