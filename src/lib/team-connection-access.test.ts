import { describe, expect, it } from "vitest"
import {
  parseTeamConnectionAccess,
  restoreTeamConnectionDefaults,
  setTeamConnectionActionAccess,
  setTeamConnectionMemberAccess,
} from "./team-connection-access.ts"

const github = { id: "app-github", service: "github" }

describe("team connection access", () => {
  it("treats an unconfigured App as Team-visible with unrestricted Actions", () => {
    expect(parseTeamConnectionAccess({}, [github])).toEqual({
      access: {},
      apps: [
        {
          actionAccess: { mode: "unrestricted" },
          appId: "app-github",
          memberAccess: { mode: "team" },
          mode: "default",
          service: "github",
        },
      ],
      ok: true,
    })
  })

  it("does not treat a user role without its App role as a restricted grant", () => {
    const parsed = parseTeamConnectionAccess({ "user::alice": { roles: ["connector-app:app-github"] } }, [github])
    expect(parsed).toMatchObject({
      apps: [{ actionAccess: { mode: "unrestricted" }, memberAccess: { mode: "team" }, mode: "default" }],
      ok: true,
    })
  })

  it("rejects a Connector rule scoped to a different App", () => {
    const slack = { id: "app-slack", service: "slack" }

    expect(
      parseTeamConnectionAccess(
        {
          "role::connector-app:app-github": {
            connector: [{ app: ["app-slack"], method: "POST", provider: "github", requireRole: true }],
          },
        },
        [github, slack],
      ),
    ).toMatchObject({
      apps: [
        { appId: "app-github", mode: "invalid" },
        { appId: "app-slack", mode: "default" },
      ],
      ok: true,
    })
  })

  it("writes selected members separately from a restricted Action allowlist", () => {
    const withMembers = setTeamConnectionMemberAccess({}, github, { mode: "selected", userIds: ["bob", "alice"] })
    const next = setTeamConnectionActionAccess(withMembers, github, {
      actionNames: ["issues.create", "issues.list", "issues.create"],
      mode: "restricted",
    })

    expect(next).toEqual({
      "role::connector-app:app-github": {
        connector: [
          {
            actions: ["issues.create", "issues.list"],
            app: ["app-github"],
            method: "POST",
            provider: "github",
            requireRole: true,
          },
        ],
      },
      "user::alice": { roles: ["connector-app:app-github"] },
      "user::bob": { roles: ["connector-app:app-github"] },
    })
  })

  it("preserves an empty Action allowlist as deny-all", () => {
    const next = setTeamConnectionActionAccess({}, github, { actionNames: [], mode: "restricted" })
    expect(parseTeamConnectionAccess(next, [github])).toMatchObject({
      apps: [{ actionAccess: { actionNames: [], mode: "restricted" }, memberAccess: { mode: "team" } }],
      ok: true,
    })
  })

  it("removes legacy user connector rules when writing the current contract", () => {
    const next = setTeamConnectionMemberAccess(
      { "user::alice": { connector: [{ method: "POST", provider: ["github"] }], note: "keep" } },
      github,
      { mode: "selected", userIds: ["alice"] },
    )
    expect(next["user::alice"]).toEqual({ note: "keep", roles: ["connector-app:app-github"] })
  })

  it("fails closed for malformed configured roles while unrelated Apps remain usable", () => {
    const parsed = parseTeamConnectionAccess(
      { "role::connector-app:app-github": { connector: [{ method: "GET", provider: "github" }] } },
      [github, { id: "app-slack", service: "slack" }],
    )
    expect(parsed).toMatchObject({
      apps: [
        { appId: "app-github", mode: "invalid" },
        { appId: "app-slack", mode: "default" },
      ],
      ok: true,
    })
  })

  it("restores the App default without touching unrelated user roles", () => {
    expect(
      restoreTeamConnectionDefaults(
        {
          "role::connector-app:app-github": { connector: [] },
          "user::alice": { roles: ["connector-app:app-github", "team-admin"] },
        },
        "app-github",
      ),
    ).toEqual({ "user::alice": { roles: ["team-admin"] } })
  })
})
