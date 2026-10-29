import type { ConnectionActionCatalogItem } from "../../../electron/connections/common.ts"
import type { TeamMember } from "../../../electron/teams/common.ts"

import { describe, expect, it } from "vitest"
import {
  connectionAccessSaveDisabled,
  connectionRuleMembers,
  connectionMemberLabel,
  removeGuestConnectionAssignments,
  canRestoreConnectionAccess,
  createConnectionPermissionRuleGrant,
  createDefaultActionPolicies,
  getActionPolicy,
  getActionGroupPolicy,
  isConnectionAccessConflict,
  mergeConnectionRuleAssignments,
  unavailableActionNames,
  setActionPolicies,
} from "./connection-access-model.ts"
import {
  parseTeamConnectionAccess,
  setConnectionPermissionRules,
  getConnectionRuleMemberIds,
} from "@/lib/team-connection-access"

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
      actionAccess: { actionPolicies: {}, mode: "restricted" },
    })
  })

  it("initializes read, write, and destructive Actions with their agreed policies", () => {
    const defaults = createDefaultActionPolicies(actions)
    expect(defaults).toEqual({ get_issue: "allow", list_issues: "allow", create_issue: "ask_advisory" })
    expect(createConnectionPermissionRuleGrant(actions)).toEqual({
      actionAccess: { mode: "restricted", actionPolicies: defaults },
    })
    expect(getActionPolicy(defaults, "delete_issue")).toBe("deny")
    expect(getActionGroupPolicy(defaults, actions)).toBe("mixed")
  })

  it("preserves unavailable and advisory policies while editing or denying a full group", () => {
    const policies = { legacy_action: "ask_advisory" as const, list_issues: "allow" as const }
    expect(unavailableActionNames(policies, actions)).toEqual(["legacy_action"])
    expect(setActionPolicies(policies, ["get_issue", "list_issues"], "deny")).toEqual({ legacy_action: "ask_advisory" })
    expect(setActionPolicies({}, ["call_tool"], "allow")).toEqual({})
    expect(setActionPolicies({}, ["list_issues"], "ask_advisory")).toEqual({ list_issues: "ask_advisory" })
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

it("excludes unresolved guests from both default members and rule assignments, retaining ordinary service accounts", () => {
  const members: TeamMember[] = [
    { user_id: "creator", role: "creator" },
    { user_id: "guest", role: "guest", user_type: "service-account" },
    { user_id: "assigned", role: "member" },
    { user_id: "worker", role: "member", user_type: "service-account", name: "guest" },
  ]
  const eligible = connectionRuleMembers(members)
  const ids = eligible.map((member) => member.user_id)
  expect(ids).toEqual(["creator", "assigned", "worker"])
  const app = { id: "app-test", service: "github" }
  const policy = setConnectionPermissionRules({}, app, {
    assignments: { assigned: "writers", guest: "writers" },
    rules: [{ id: "writers", name: "Writers", actionAccess: { mode: "unrestricted" } }],
    teamDefault: { actionAccess: { mode: "unrestricted" } },
  })
  const parsed = parseTeamConnectionAccess(policy, [app], ids)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error("Invalid policy")
  const access = parsed.apps[0]!
  if (access.mode === "invalid") throw new Error("Invalid app policy")
  expect(getConnectionRuleMemberIds(access.permissionRules, "writers")).toEqual(["assigned"])
  expect(ids.filter((id) => !access.permissionRules.assignments[id])).toEqual(["creator", "worker"])
})

it("removes known guest assignments on save without discarding unknown or ordinary service accounts", () => {
  const members: TeamMember[] = [
    { user_id: "guest", role: "guest", user_type: "service-account" },
    { user_id: "worker", role: "member", user_type: "service-account", name: "guest" },
    { user_id: "user", role: "member" },
  ]
  const assignments = { guest: "writers", worker: "writers", user: "writers", unknown: "writers" }
  const cleaned = removeGuestConnectionAssignments(assignments, members)
  expect(cleaned).toEqual({ worker: "writers", user: "writers", unknown: "writers" })
  const merged = mergeConnectionRuleAssignments(cleaned, "writers", ["worker"], ["worker", "user"])
  expect(merged).toEqual({ worker: "writers", unknown: "writers" })
  const app = { id: "app-test", service: "github" }
  const policy = setConnectionPermissionRules({}, app, {
    assignments: merged,
    rules: [{ id: "writers", name: "Writers", actionAccess: { mode: "unrestricted" } }],
    teamDefault: { actionAccess: { mode: "restricted", actionPolicies: {} } },
  })
  const parsed = parseTeamConnectionAccess(policy, [app])
  if (!parsed.ok || parsed.apps[0]?.mode === "invalid") throw new Error("Invalid policy")
  expect(parsed.apps[0]?.permissionRules.assignments).toEqual({ worker: "writers", unknown: "writers" })
  expect(assignments.guest).toBe("writers")
})

it("uses service-account names for labels while preserving user summaries and ID fallback", () => {
  expect(connectionMemberLabel("sa-worker", {}, "  Deployment Bot  ")).toBe("Deployment Bot")
  expect(connectionMemberLabel("sa-worker", {}, "  ")).toBe("sa-worker")
  expect(connectionMemberLabel("sa-worker", {})).toBe("sa-worker")
  expect(connectionMemberLabel("user", { user: { nickname: "Alice", username: "alice" } }, "Other")).toBe("Alice")
  expect(connectionMemberLabel("user", { user: { nickname: "", username: "alice" } }, "Other")).toBe("alice")
})
