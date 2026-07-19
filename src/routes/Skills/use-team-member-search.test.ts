import type { MemberSearchState } from "./team-management-model.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { preferredSearchUserId, retainedSelectedSearchUserId } from "./use-team-member-search.ts"

const users = [
  {
    avatar: "",
    displayName: "Alice",
    fallback: "A",
    nickname: "Alice",
    user_id: "user-a",
    userId: "user-a",
    username: "alice",
  },
  {
    avatar: "",
    displayName: "Bob",
    fallback: "B",
    nickname: "Bob",
    user_id: "user-b",
    userId: "user-b",
    username: "bob",
  },
] satisfies MemberSearchState["items"]

test("search navigation prefers an exact match without selecting it", () => {
  assert.equal(preferredSearchUserId(users, "bob", null), "user-b")
  assert.equal(retainedSelectedSearchUserId(users, null), null)
})

test("search selection is retained only while the selected result remains visible", () => {
  assert.equal(retainedSelectedSearchUserId(users, "user-a"), "user-a")
  assert.equal(retainedSelectedSearchUserId(users.slice(1), "user-a"), null)
})
