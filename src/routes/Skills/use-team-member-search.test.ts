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

test("submission requires a current selected result or a complete direct UUID", async () => {
  const { resolveMemberInput } = await import("./team-management-model.ts")
  const search = { items: users, loading: false, error: null, query: "alice" }
  assert.equal(resolveMemberInput("alice", search, "user-a"), "user-a")
  assert.equal(resolveMemberInput("alice", search, "missing"), null)
  assert.equal(resolveMemberInput("bob", search, "user-a"), null)
  assert.equal(resolveMemberInput("alice", { ...search, loading: true }, "user-a"), null)
  assert.equal(resolveMemberInput("alice", { ...search, items: [], error: "offline" }, null), null)
  const id = "019fb724-1500-7d79-a783-1642d99ed93e"
  assert.equal(resolveMemberInput(` ${id} `, { ...search, items: [], query: id, error: "offline" }, null), id)
})
