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
  maxOrganizationNameLength,
  organizationNameValidation,
  organizationRole,
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

test("buildMemberViews and buildGrantViews decorate users and provider labels", () => {
  const members = buildMemberViews([member("user-a"), member("user-b")], {
    "user-a": {
      nickname: "Alice",
      url: "https://avatar.example/a.png",
      username: "alice",
    } satisfies OrganizationUserSummary,
  })
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

test("providerOptionsWithSelected keeps selected unknown providers visible", () => {
  assert.deepEqual(providerOptionsWithSelected([{ label: "Slack", service: "slack" }], ["gmail", "slack"]), [
    { label: "gmail", service: "gmail" },
    { label: "Slack", service: "slack" },
  ])
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
