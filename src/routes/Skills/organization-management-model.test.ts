import type {
  Organization,
  OrganizationMember,
  OrganizationOverview,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  allOrganizations,
  buildGrantViews,
  buildMemberViews,
  buildOrganizationMemberViews,
  createOrganizationSkillPackageSet,
  maxOrganizationNameLength,
  organizationCanManage,
  organizationNameValidation,
  organizationRole,
  organizationSkillPackageLinked,
  planProviderSkillRecommendationBulkLinks,
  planOrganizationSkillBulkLinks,
  providerOptionsWithSelected,
} from "./organization-management-model.ts"

test("organizationNameValidation accepts the product naming rules", () => {
  assert.equal(organizationNameValidation(""), "empty")
  assert.equal(organizationNameValidation("bad name"), "invalid")
  assert.equal(organizationNameValidation("a".repeat(maxOrganizationNameLength + 1)), "too-long")
  assert.equal(organizationNameValidation("team.alpha-1"), "valid")
})

test("allOrganizations de-duplicates created and joined organizations", () => {
  const overview = organizationOverview({
    created: [organization("a"), organization("b")],
    joined: [organization("b"), organization("c")],
  })

  assert.deepEqual(
    allOrganizations(overview).map((organization) => organization.id),
    ["a", "b", "c"],
  )
})

test("organizationRole prefers creator ownership from account and created list", () => {
  const owned = organization("owned", "account-a")
  const created = organization("created", "other")
  const joined = organization("joined", "other")
  const overview = organizationOverview({
    accountId: "account-a",
    created: [created],
    joined: [owned, joined],
  })

  assert.equal(organizationRole(overview, owned), "creator")
  assert.equal(organizationRole(overview, created), "creator")
  assert.equal(organizationRole(overview, joined), "member")
})

test("organizationRole prefers the role returned by the organization schema", () => {
  const overview = organizationOverview({
    accountId: "account-a",
    created: [],
    joined: [
      {
        ...organization("managed", "other"),
        role: "creator",
      },
      {
        ...organization("owned", "account-a"),
        role: "member",
      },
    ],
  })

  assert.equal(organizationRole(overview, overview.joined[0] ?? null), "creator")
  assert.equal(organizationRole(overview, overview.joined[1] ?? null), "member")
})

test("organizationCanManage prefers writable and falls back to role", () => {
  const created = organization("legacy-created", "other")
  const overview = organizationOverview({
    accountId: "account-a",
    created: [created],
    joined: [
      {
        ...organization("writable-member", "other"),
        role: "member",
        writable: true,
      },
      {
        ...organization("readonly-creator", "account-a"),
        role: "creator",
        writable: false,
      },
      {
        ...organization("schema-creator", "other"),
        role: "creator",
      },
      organization("legacy-owned", "account-a"),
      created,
    ],
  })

  assert.equal(organizationCanManage(overview, overview.joined[0] ?? null), true)
  assert.equal(organizationCanManage(overview, overview.joined[1] ?? null), false)
  assert.equal(organizationCanManage(overview, overview.joined[2] ?? null), true)
  assert.equal(organizationCanManage(overview, overview.joined[3] ?? null), true)
  assert.equal(organizationCanManage(overview, overview.joined[4] ?? null), true)
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
      } satisfies OrganizationUserSummary,
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

test("buildOrganizationMemberViews falls back to creator and current account", () => {
  const org = {
    ...organization("org-a", "creator-a"),
    role: "member",
  } satisfies Organization
  const members = buildOrganizationMemberViews({
    account: {
      avatarUrl: "https://avatar.example/me.png",
      id: "account-a",
      name: "Current User",
    },
    accountRole: "member",
    members: [],
    organization: org,
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

test("organization skill package set normalizes package names", () => {
  const packageKeys = createOrganizationSkillPackageSet([
    { packageName: " oo-gmail " },
    { packageName: "OO-SLACK" },
    { packageName: "" },
  ])

  assert.equal(organizationSkillPackageLinked(packageKeys, "oo-gmail"), true)
  assert.equal(organizationSkillPackageLinked(packageKeys, "oo-slack"), true)
  assert.equal(organizationSkillPackageLinked(packageKeys, "oo-notion"), false)
})

test("planOrganizationSkillBulkLinks deduplicates by package and skips linked packages", () => {
  const plan = planOrganizationSkillBulkLinks(
    [
      { packageName: "oo-gmail", skillName: "gmail" },
      { packageName: "OO-GMAIL", skillName: "gmail-alt" },
      { packageName: "oo-slack", skillName: "slack" },
      { packageName: "oo-notion", skillName: "notion" },
    ],
    [{ packageName: " oo-slack " }],
  )

  assert.deepEqual(
    plan.linkable.map((item) => item.skillName),
    ["gmail", "notion"],
  )
  assert.deepEqual(
    plan.linked.map((item) => item.skillName),
    ["slack"],
  )
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

function organization(id: string, creatorUserId = "creator"): Organization {
  return {
    avatar: "",
    creator_user_id: creatorUserId,
    id,
    name: id,
  }
}

function organizationOverview(request: {
  accountId?: string
  created: Organization[]
  joined: Organization[]
}): OrganizationOverview {
  return {
    accountId: request.accountId ?? "account",
    created: request.created,
    joined: request.joined,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function member(userId: string): OrganizationMember {
  return {
    role: "member",
    user_id: userId,
  }
}
