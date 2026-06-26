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
  organizationCanManage,
  organizationNameValidation,
  organizationRole,
  providerOptionsWithSelected,
  readSelectedOrganizationId,
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

test("readSelectedOrganizationId migrates legacy Lumo storage key", () => {
  const localStorage = new MemoryStorage()
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  })

  try {
    localStorage.setItem("lumo:organization-management:selected-organization:account-a", "org-a")

    assert.equal(readSelectedOrganizationId("account-a"), "org-a")
    assert.equal(localStorage.getItem("wanta:organization-management:selected-organization:account-a"), "org-a")
    assert.equal(localStorage.getItem("lumo:organization-management:selected-organization:account-a"), null)
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    })
  }
})

class MemoryStorage {
  private values = new Map<string, string>()

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  public removeItem(key: string): void {
    this.values.delete(key)
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

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
