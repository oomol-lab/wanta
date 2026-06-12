import assert from "node:assert/strict"
import { test } from "vitest"
import { hasPrereleaseTag, resolveUpdateChannel, updaterChannelName } from "./channel.ts"

test("hasPrereleaseTag detects -beta.N style versions", () => {
  assert.equal(hasPrereleaseTag("1.0.0"), false)
  assert.equal(hasPrereleaseTag("0.0.0"), false)
  assert.equal(hasPrereleaseTag("1.0.1-beta.1"), true)
  assert.equal(hasPrereleaseTag("2.3.4-beta.20260612"), true)
  assert.equal(hasPrereleaseTag("not-a-version"), false)
})

test("resolveUpdateChannel prefers explicit user setting", () => {
  assert.equal(resolveUpdateChannel("beta", "1.0.0"), "beta")
  assert.equal(resolveUpdateChannel("stable", "1.0.1-beta.2"), "stable")
})

test("resolveUpdateChannel derives from own version when unset", () => {
  // 正式包默认 stable；beta 直装包首跑留在 beta（不会自我切回 stable）。
  assert.equal(resolveUpdateChannel(undefined, "1.0.0"), "stable")
  assert.equal(resolveUpdateChannel(undefined, "1.0.1-beta.2"), "beta")
})

test("resolveUpdateChannel treats invalid persisted value as unset", () => {
  assert.equal(resolveUpdateChannel("nightly", "1.0.0"), "stable")
  assert.equal(resolveUpdateChannel("", "1.0.1-beta.1"), "beta")
})

test("updaterChannelName maps stable to latest yml channel", () => {
  assert.equal(updaterChannelName("stable"), "latest")
  assert.equal(updaterChannelName("beta"), "beta")
})
