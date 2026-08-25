import { describe, expect, it } from "vitest"
import {
  addConnectionPermissionRule,
  getConnectionPermissionGrant,
  getConnectionPermissionRule,
  getConnectionLingxingUserAccess,
  hasTeamConnectionAppAccess,
  parseTeamConnectionAccess,
  removeConnectionPermissionRule,
  restoreTeamConnectionDefaults,
  setConnectionRuleAssignments,
  setConnectionLingxingUserAccess,
  setConnectionTeamDefault,
  updateConnectionPermissionRule,
} from "./team-connection-access.ts"

const github = { id: "app-github", service: "github" }
const configured = {
  "role::connector-app:app-github": {
    connector: [
      {
        app: ["app-github"],
        method: "POST",
        permissionRules: {
          assignments: { alice: "writers", ghost: "missing" },
          rules: [{ actions: ["issues.create"], id: "writers", name: "Writers" }],
          teamDefault: { actions: ["issues.list"] },
        },
        provider: "github",
      },
    ],
  },
}

describe("team connection access v2", () => {
  it("projects an unconfigured App to an unrestricted team default", () => {
    expect(parseTeamConnectionAccess({}, [github])).toEqual({
      access: {},
      apps: [
        {
          appId: "app-github",
          mode: "default",
          permissionRules: {
            assignments: {},
            rules: [],
            teamDefault: { actionAccess: { mode: "unrestricted" } },
          },
          service: "github",
        },
      ],
      ok: true,
    })
  })

  it("rejects the historical requireRole contract instead of migrating it", () => {
    const parsed = parseTeamConnectionAccess(
      { "role::connector-app:app-github": { connector: [{ method: "POST", provider: "github", requireRole: true }] } },
      [github],
    )
    expect(parsed).toMatchObject({ apps: [{ appId: "app-github", mode: "invalid" }], ok: true })
  })

  it("uses assignments as the only member-to-rule authority", () => {
    const parsed = parseTeamConnectionAccess(configured, [github], ["alice", "bob"])
    if (!parsed.ok) throw new Error("Expected a valid policy")
    const app = parsed.apps[0]
    if (!app) throw new Error("Expected an App")
    expect(getConnectionPermissionRule(app, "alice")?.name).toBe("Writers")
    expect(getConnectionPermissionRule(app, "bob")).toBeNull()
    expect(getConnectionPermissionGrant(app, "bob")).toEqual({
      actionAccess: { actionNames: ["issues.list"], mode: "restricted" },
    })
    expect(app.mode === "invalid" ? null : app.permissionRules.assignments).toEqual({ alice: "writers" })
  })

  it("treats deny-all as unavailable", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [
            {
              method: "POST",
              permissionRules: { assignments: {}, rules: [], teamDefault: { actions: [] } },
              provider: "github",
            },
          ],
        },
      },
      [github],
    )
    if (!parsed.ok || !parsed.apps[0]) throw new Error("Expected an App")
    expect(hasTeamConnectionAppAccess(parsed.apps[0], "alice")).toBe(false)
  })

  it("preserves appAccessConfig while changing team default Actions", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [
            {
              method: "POST",
              permissionRules: {
                assignments: {},
                rules: [],
                teamDefault: { appAccessConfig: { scope: { tenant: "one" } } },
              },
              provider: "github",
            },
          ],
        },
      },
      [github],
    )
    if (!parsed.ok || parsed.apps[0]?.mode === "invalid" || !parsed.apps[0]) throw new Error("Expected valid")
    const next = setConnectionTeamDefault(parsed.access, github, parsed.apps[0].permissionRules, {
      ...parsed.apps[0].permissionRules.teamDefault,
      actionAccess: { actionNames: [], mode: "restricted" },
    })
    expect(next["role::connector-app:app-github"]?.connector).toMatchObject([
      { permissionRules: { teamDefault: { actions: [], appAccessConfig: { scope: { tenant: "one" } } } } },
    ])
  })

  it("keeps Lingxing unrestricted and empty owner scopes distinct", () => {
    const grant = { actionAccess: { mode: "unrestricted" } as const }
    const selected = setConnectionLingxingUserAccess(grant, { mode: "selected", users: [] })
    expect(selected.appAccessConfig).toEqual({ users: [] })
    expect(getConnectionLingxingUserAccess(selected)).toEqual({ mode: "selected", users: [] })
    expect(setConnectionLingxingUserAccess(selected, { mode: "all" })).toEqual(grant)
  })

  it("adds, updates, assigns, and removes a named rule canonically", () => {
    const parsed = parseTeamConnectionAccess({}, [github])
    if (!parsed.ok || parsed.apps[0]?.mode === "invalid" || !parsed.apps[0]) throw new Error("Expected valid")
    const rule = {
      actionAccess: { actionNames: ["issues.list"], mode: "restricted" as const },
      id: "readers",
      name: "Readers",
    }
    let next = addConnectionPermissionRule(parsed.access, github, parsed.apps[0].permissionRules, rule)
    let nextParsed = parseTeamConnectionAccess(next, [github], ["alice"])
    if (!nextParsed.ok || nextParsed.apps[0]?.mode === "invalid" || !nextParsed.apps[0])
      throw new Error("Expected valid")
    next = setConnectionRuleAssignments(nextParsed.access, github, nextParsed.apps[0].permissionRules, "readers", [
      "alice",
    ])
    nextParsed = parseTeamConnectionAccess(next, [github], ["alice"])
    if (!nextParsed.ok || nextParsed.apps[0]?.mode === "invalid" || !nextParsed.apps[0])
      throw new Error("Expected valid")
    next = updateConnectionPermissionRule(nextParsed.access, github, nextParsed.apps[0].permissionRules, {
      ...nextParsed.apps[0].permissionRules.rules[0]!,
      name: "Auditors",
    })
    nextParsed = parseTeamConnectionAccess(next, [github], ["alice"])
    if (!nextParsed.ok || nextParsed.apps[0]?.mode === "invalid" || !nextParsed.apps[0])
      throw new Error("Expected valid")
    expect(getConnectionPermissionRule(nextParsed.apps[0], "alice")?.name).toBe("Auditors")
    next = removeConnectionPermissionRule(nextParsed.access, github, nextParsed.apps[0].permissionRules, "readers")
    expect(next["role::connector-app:app-github"]?.connector).toMatchObject([
      { permissionRules: { assignments: {}, rules: [] } },
    ])
  })

  it("uses the role subject as App identity and canonicalizes the nested app on write", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [
            {
              app: ["wrong"],
              method: "POST",
              permissionRules: { assignments: {}, rules: [], teamDefault: {} },
              provider: "github",
            },
            { ignored: true },
          ],
        },
      },
      [github],
    )
    if (!parsed.ok || parsed.apps[0]?.mode === "invalid" || !parsed.apps[0]) throw new Error("Expected valid")
    const next = setConnectionTeamDefault(parsed.access, github, parsed.apps[0].permissionRules, {
      actionAccess: { mode: "unrestricted" },
    })
    expect(next["role::connector-app:app-github"]?.connector).toEqual([
      {
        app: ["app-github"],
        method: "POST",
        permissionRules: { assignments: {}, rules: [], teamDefault: {} },
        provider: "github",
      },
    ])
  })

  it("restores only the selected App to its final unconfigured default", () => {
    expect(restoreTeamConnectionDefaults({ ...configured, keep: { value: true } }, "app-github")).toEqual({
      keep: { value: true },
    })
  })
})
