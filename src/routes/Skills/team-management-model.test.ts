import type { Team, TeamMember, TeamOverview, TeamUserSummary } from "../../../electron/teams/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildGrantViews,
  buildMemberViews,
  buildTeamMemberViews,
  createTeamSkillPackageSet,
  errorState,
  filterTeamProviderOptions,
  maxTeamNameLength,
  loadState,
  teamCanManage,
  teamNameValidation,
  teamOperationTargetsCurrentTeam,
  teamRole,
  teamSkillPackageLinked,
  planProviderSkillRecommendationBulkLinks,
  providerOptionsWithSelected,
  refreshAfterCommittedTeamMutation,
} from "./team-management-model.ts"
import { scopedBusyOperationIsCurrent } from "./use-scoped-busy-action.ts"

test("teamNameValidation accepts the product naming rules", () => {
  assert.equal(teamNameValidation(""), "empty")
  assert.equal(teamNameValidation("bad name"), "invalid")
  assert.equal(teamNameValidation("team’s"), "invalid")
  assert.equal(teamNameValidation("a".repeat(maxTeamNameLength + 1)), "too-long")
  assert.equal(teamNameValidation("team.alpha-1"), "valid")
  assert.equal(teamNameValidation("alwaysmavs'team"), "valid")
})

test("errorState preserves a structured HTTP status for permission-aware UI", () => {
  const state = errorState(loadState(["cached"]), Object.assign(new Error("forbidden"), { status: 403 }))

  assert.deepEqual(state, {
    data: ["cached"],
    error: "forbidden",
    errorStatus: 403,
    status: "error",
  })
})

test("teamRole prefers creator ownership from account and created list", () => {
  const owned = team("owned", "account-a")
  const created = team("created", "other")
  const joined = team("joined", "other")
  const overview = teamOverview({
    accountId: "account-a",
    created: [created],
    joined: [owned, joined],
  })

  assert.equal(teamRole(overview, owned), "creator")
  assert.equal(teamRole(overview, created), "creator")
  assert.equal(teamRole(overview, joined), "member")
})

test("teamRole prefers the role returned by the team schema", () => {
  const overview = teamOverview({
    accountId: "account-a",
    created: [],
    joined: [
      {
        ...team("managed", "other"),
        role: "creator",
      },
      {
        ...team("owned", "account-a"),
        role: "member",
      },
    ],
  })

  assert.equal(teamRole(overview, overview.joined[0] ?? null), "creator")
  assert.equal(teamRole(overview, overview.joined[1] ?? null), "member")
})

test("teamCanManage prefers writable and falls back to role", () => {
  const created = team("legacy-created", "other")
  const overview = teamOverview({
    accountId: "account-a",
    created: [created],
    joined: [
      {
        ...team("writable-member", "other"),
        role: "member",
        writable: true,
      },
      {
        ...team("readonly-creator", "account-a"),
        role: "creator",
        writable: false,
      },
      {
        ...team("schema-creator", "other"),
        role: "creator",
      },
      team("legacy-owned", "account-a"),
      created,
    ],
  })

  assert.equal(teamCanManage(overview, overview.joined[0] ?? null), true)
  assert.equal(teamCanManage(overview, overview.joined[1] ?? null), false)
  assert.equal(teamCanManage(overview, overview.joined[2] ?? null), true)
  assert.equal(teamCanManage(overview, overview.joined[3] ?? null), true)
  assert.equal(teamCanManage(overview, overview.joined[4] ?? null), true)
})

test("buildMemberViews and buildGrantViews decorate users, status, and provider labels", () => {
  const members = buildMemberViews(
    [
      { ...member("user-a"), disable: false },
      { ...member("user-b"), disable: true },
    ],
    {
      "user-a": {
        nickname: "Alice",
        url: "https://avatar.example/a.png",
        username: "alice",
      } satisfies TeamUserSummary,
    },
  )
  const grants = buildGrantViews(
    {
      "user::user-a": {
        connector: [{ method: "POST", provider: ["gmail", "unknown"] }],
      },
    },
    members,
    [{ label: "Gmail", service: "gmail" }],
  )

  assert.equal(members[0]?.displayName, "Alice")
  assert.equal(members[0]?.disable, false)
  assert.equal(members[1]?.disable, true)
  assert.equal(members[0]?.secondaryLabel, "user-a")
  assert.equal(grants.error, null)
  assert.deepEqual(grants.grants[0], {
    allProviders: false,
    member: members[0],
    providers: [
      { label: "Gmail", service: "gmail" },
      { label: "unknown", service: "unknown" },
    ],
    userId: "user-a",
  })
})

test("buildTeamMemberViews falls back to creator and current account", () => {
  const selectedTeam = {
    ...team("team-a", "creator-a"),
    role: "member",
  } satisfies Team
  const members = buildTeamMemberViews({
    account: {
      avatarUrl: "https://avatar.example/me.png",
      id: "account-a",
      name: "Current User",
    },
    accountRole: "member",
    members: [],
    team: selectedTeam,
    summaries: {},
  })

  assert.deepEqual(
    members.map((member) => ({ displayName: member.displayName, role: member.role, user_id: member.user_id })),
    [
      { displayName: "creator-a", role: "creator", user_id: "creator-a" },
      { displayName: "Current User", role: "member", user_id: "account-a" },
    ],
  )
  assert.equal(members[1]?.avatar, "https://avatar.example/me.png")
})

test("providerOptionsWithSelected keeps selected unknown providers visible", () => {
  assert.deepEqual(providerOptionsWithSelected([{ label: "Slack", service: "slack" }], ["gmail", "slack"]), [
    { label: "gmail", service: "gmail" },
    { label: "Slack", service: "slack" },
  ])
})

test("filterTeamProviderOptions matches labels and service ids", () => {
  const options = [
    { label: "Google Mail", service: "gmail" },
    { label: "Microsoft Teams", service: "microsoft-teams" },
  ]

  assert.deepEqual(filterTeamProviderOptions(options, " mail "), [options[0]])
  assert.deepEqual(filterTeamProviderOptions(options, "MICROSOFT-TEAMS"), [options[1]])
  assert.deepEqual(filterTeamProviderOptions(options, ""), options)
  assert.deepEqual(filterTeamProviderOptions(options, "slack"), [])
})

test("team skill package set normalizes package names", () => {
  const packageKeys = createTeamSkillPackageSet([
    { packageName: " oo-gmail " },
    { packageName: "OO-SLACK" },
    { packageName: "" },
  ])

  assert.equal(teamSkillPackageLinked(packageKeys, "oo-gmail"), true)
  assert.equal(teamSkillPackageLinked(packageKeys, "oo-slack"), true)
  assert.equal(teamSkillPackageLinked(packageKeys, "oo-notion"), false)
})

test("planProviderSkillRecommendationBulkLinks deduplicates by package and skips linked packages", () => {
  const plan = planProviderSkillRecommendationBulkLinks(
    [
      { packageName: "oo-gmail", skillId: "gmail" },
      { packageName: "OO-GMAIL", skillId: "gmail" },
      { packageName: "oo-gmail", skillId: "gmail-admin" },
      { packageName: "oo-slack", skillId: "slack" },
    ],
    [{ packageName: " oo-slack " }],
  )

  assert.deepEqual(
    plan.linkable.map((item) => item.skillId),
    ["gmail"],
  )
  assert.deepEqual(
    plan.linked.map((item) => item.skillId),
    ["slack"],
  )
})

test("refreshAfterCommittedTeamMutation reports refresh failure without rejecting the committed mutation", async () => {
  const refreshError = new Error("offline")
  let reportedError: unknown

  const refreshed = await refreshAfterCommittedTeamMutation(
    () => Promise.reject(refreshError),
    (error) => {
      reportedError = error
    },
  )

  assert.equal(refreshed, false)
  assert.equal(reportedError, refreshError)
})

test("refreshAfterCommittedTeamMutation returns true without reporting a failure after refresh succeeds", async () => {
  let failureReported = false

  const refreshed = await refreshAfterCommittedTeamMutation(
    () => Promise.resolve(),
    () => {
      failureReported = true
    },
  )

  assert.equal(refreshed, true)
  assert.equal(failureReported, false)
})

test("scoped busy operations reject stale ids and stale team contexts", () => {
  const operation = { action: "addSkillBatch" as const, contextKey: "account-1\u0000team-1", id: 3 }

  assert.equal(scopedBusyOperationIsCurrent(operation, 3, "account-1\u0000team-1"), true)
  assert.equal(scopedBusyOperationIsCurrent(operation, 4, "account-1\u0000team-1"), false)
  assert.equal(scopedBusyOperationIsCurrent(operation, 3, "account-1\u0000team-2"), false)
})

test("team mutations reject confirmation targets captured in another team", () => {
  assert.equal(teamOperationTargetsCurrentTeam("team-1", "team-1"), true)
  assert.equal(teamOperationTargetsCurrentTeam("team-1", "team-2"), false)
  assert.equal(teamOperationTargetsCurrentTeam("team-1", null), false)
})

function team(id: string, creatorUserId = "creator"): Team {
  return {
    avatar: "",
    creator_user_id: creatorUserId,
    id,
    name: id,
  }
}

function teamOverview(request: { accountId?: string; created: Team[]; joined: Team[] }): TeamOverview {
  return {
    accountId: request.accountId ?? "account",
    created: request.created,
    joined: request.joined,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function member(userId: string): TeamMember {
  return {
    role: "member",
    user_id: userId,
  }
}
