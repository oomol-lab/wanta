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
const lingxing = { id: "app-lingxing", service: "lingxing" }
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

  it("reads the historical requireRole contract and migrates it on write", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [{ actions: ["issues.list"], method: "POST", provider: "github", requireRole: true }],
        },
        "user::alice": { roles: ["connector-app:app-github", "other-role"] },
      },
      [github],
      ["alice"],
    )
    if (!parsed.ok || parsed.apps[0]?.mode !== "configured") throw new Error("Expected a legacy policy")
    expect(parsed.apps[0].format).toBe("legacy")
    expect(getConnectionPermissionGrant(parsed.apps[0], "alice")?.actionAccess).toEqual({
      actionNames: ["issues.list"],
      mode: "restricted",
    })

    const next = setConnectionTeamDefault(
      parsed.access,
      github,
      parsed.apps[0].permissionRules,
      parsed.apps[0].permissionRules.teamDefault,
    )
    const role = (next["role::connector-app:app-github"] as { connector?: Record<string, unknown>[] })?.connector?.[0]
    expect(role).not.toHaveProperty("requireRole")
    expect(role).toHaveProperty("permissionRules")
    expect(next["user::alice"]).toEqual({ roles: ["other-role"] })
  })

  it("rejects effect and unknown fields in a v2 Connector rule", () => {
    for (const extra of [{ effect: "deny" }, { unknown: true }]) {
      const parsed = parseTeamConnectionAccess(
        {
          "role::connector-app:app-github": {
            connector: [
              {
                ...extra,
                method: "POST",
                permissionRules: { assignments: {}, rules: [], teamDefault: {} },
                provider: "github",
              },
            ],
          },
        },
        [github],
      )
      expect(parsed).toMatchObject({ apps: [{ mode: "invalid" }], ok: true })
    }
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

  it("preserves Lingxing appAccessConfig while changing team default Actions", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-lingxing": {
          connector: [
            {
              method: "POST",
              permissionRules: {
                assignments: {},
                rules: [],
                teamDefault: { appAccessConfig: { scope: { tenant: "one" } } },
              },
              provider: "lingxing",
            },
          ],
        },
      },
      [lingxing],
    )
    if (!parsed.ok || parsed.apps[0]?.mode === "invalid" || !parsed.apps[0]) throw new Error("Expected valid")
    const next = setConnectionTeamDefault(parsed.access, lingxing, parsed.apps[0].permissionRules, {
      ...parsed.apps[0].permissionRules.teamDefault,
      actionAccess: { actionNames: [], mode: "restricted" },
    })
    expect(next["role::connector-app:app-lingxing"]?.connector).toMatchObject([
      { permissionRules: { teamDefault: { actions: [], appAccessConfig: { scope: { tenant: "one" } } } } },
    ])
  })

  it("rejects appAccessConfig for non-Lingxing providers", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-github": {
          connector: [
            {
              method: "POST",
              permissionRules: { assignments: {}, rules: [], teamDefault: { appAccessConfig: {} } },
              provider: "github",
            },
          ],
        },
      },
      [github],
    )
    expect(parsed).toMatchObject({ apps: [{ mode: "invalid" }], ok: true })
  })

  it("keeps Lingxing unrestricted and empty owner scopes distinct", () => {
    const grant = { actionAccess: { mode: "unrestricted" } as const }
    const selected = setConnectionLingxingUserAccess(grant, { mode: "selected", users: [] })
    expect(selected.appAccessConfig).toEqual({ users: [] })
    expect(getConnectionLingxingUserAccess(selected)).toEqual({ mode: "selected", users: [] })
    expect(setConnectionLingxingUserAccess(selected, { mode: "all" })).toEqual(grant)
  })

  it("drops legacy Lingxing user keys before writing canonical v2", () => {
    const parsed = parseTeamConnectionAccess(
      {
        "role::connector-app:app-lingxing": {
          connector: [
            {
              appAccessConfig: {
                users: [
                  {
                    id: 42,
                    name: "Legacy display name",
                    realname: "Alice",
                    uid: "owner-1",
                    username: "alice",
                  },
                ],
              },
              method: "POST",
              provider: "lingxing",
            },
          ],
        },
      },
      [lingxing],
    )
    if (!parsed.ok || parsed.apps[0]?.mode !== "configured") throw new Error("Expected a legacy policy")

    const next = setConnectionTeamDefault(
      parsed.access,
      lingxing,
      parsed.apps[0].permissionRules,
      parsed.apps[0].permissionRules.teamDefault,
    )
    expect(next["role::connector-app:app-lingxing"]?.connector).toMatchObject([
      {
        permissionRules: {
          teamDefault: {
            appAccessConfig: {
              users: [{ realname: "Alice", uid: "owner-1", username: "alice" }],
            },
          },
        },
      },
    ])
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
    expect(
      restoreTeamConnectionDefaults(
        {
          ...configured,
          keep: { value: true },
          "user::alice": { roles: ["connector-app:app-github", "other-role"] },
        },
        "app-github",
      ),
    ).toEqual({ keep: { value: true }, "user::alice": { roles: ["other-role"] } })
  })
})
