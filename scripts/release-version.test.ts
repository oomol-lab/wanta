import type { ComputeInput } from "./release-version.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  compareVersions,
  computeReleaseVersion,
  formatVersion,
  parseVersion,
  shouldRefreshBetaPointer,
} from "./release-version.ts"

function versionOf(input: ComputeInput): string {
  return computeReleaseVersion(input).version
}

test("parseVersion accepts stable, beta and v-prefixed forms", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3, beta: null })
  assert.deepEqual(parseVersion("v1.2.3-beta.4"), { major: 1, minor: 2, patch: 3, beta: 4 })
  assert.equal(parseVersion("1.2.3-alpha.1"), null)
  assert.equal(parseVersion("1.2"), null)
  assert.equal(parseVersion("garbage"), null)
})

test("parseVersion rejects semver-invalid leading zeros", () => {
  assert.equal(parseVersion("v01.2.3"), null)
  assert.equal(parseVersion("1.02.3"), null)
  assert.equal(parseVersion("1.2.3-beta.01"), null)
  assert.deepEqual(parseVersion("1.0.0"), { major: 1, minor: 0, patch: 0, beta: null })
})

test("compareVersions orders beta below same-base stable", () => {
  const order = ["1.0.0-beta.1", "1.0.0", "1.0.1-beta.1", "1.0.1-beta.2", "1.0.1-beta.10", "1.0.1", "1.1.0-beta.1"]
  for (let i = 1; i < order.length; i++) {
    const prev = parseVersion(order[i - 1]!)!
    const next = parseVersion(order[i]!)!
    assert.ok(compareVersions(prev, next) < 0, `${order[i - 1]} < ${order[i]}`)
  }
})

test("stable: explicit version validates X.Y.Z and rejects prerelease", () => {
  assert.equal(versionOf({ channel: "stable", expected: "v2.0.0", bump: "patch", tags: [] }), "2.0.0")
  assert.throws(() => versionOf({ channel: "stable", expected: "1.0.0-beta.1", bump: "patch", tags: [] }))
  assert.throws(() => versionOf({ channel: "stable", expected: "1.0", bump: "patch", tags: [] }))
})

test("stable: explicit version must be greater than latest stable tag (anti-rollback)", () => {
  const tags = ["v1.2.0", "v1.0.0"]
  assert.equal(versionOf({ channel: "stable", expected: "1.2.1", bump: "patch", tags }), "1.2.1")
  // 等于/低于现有 stable 都拒绝——手滑旧版本会把 latest*.yml 指针倒拨。
  assert.throws(() => versionOf({ channel: "stable", expected: "1.2.0", bump: "patch", tags }))
  assert.throws(() => versionOf({ channel: "stable", expected: "1.1.9", bump: "patch", tags }))
})

test("stable: auto-bump ignores beta tags entirely", () => {
  // 关键回归用例：beta tag 存在时 stable 自动 bump 不得爆炸、不得基于 beta 计算。
  const tags = ["v1.0.0", "v1.0.1-beta.1", "v1.0.1-beta.2", "v1.1.0-beta.1"]
  assert.equal(versionOf({ channel: "stable", expected: "", bump: "patch", tags }), "1.0.1")
  assert.equal(versionOf({ channel: "stable", expected: "", bump: "minor", tags }), "1.1.0")
  assert.equal(versionOf({ channel: "stable", expected: "", bump: "major", tags }), "2.0.0")
})

test("stable: no tags starts from 0.0.0", () => {
  assert.equal(versionOf({ channel: "stable", expected: "", bump: "patch", tags: [] }), "0.0.1")
})

test("beta: base is latest stable patch+1, N increments per base", () => {
  assert.equal(versionOf({ channel: "beta", expected: "", bump: "patch", tags: ["v1.0.0"] }), "1.0.1-beta.1")
  assert.equal(
    versionOf({ channel: "beta", expected: "", bump: "patch", tags: ["v1.0.0", "v1.0.1-beta.1"] }),
    "1.0.1-beta.2",
  )
})

test("beta: stable hotfix overtakes — base moves up automatically", () => {
  // 1.0.1 已正式发布后，下一个 beta 基线自动到 1.0.2、序号重新从 1 起。
  const tags = ["v1.0.0", "v1.0.1-beta.1", "v1.0.1-beta.2", "v1.0.1"]
  assert.equal(versionOf({ channel: "beta", expected: "", bump: "patch", tags }), "1.0.2-beta.1")
})

test("beta: manually raised baseline is kept", () => {
  // 团队曾显式发过 2.0.0-beta.1：后续自动 beta 沿用 2.0.0 基线而非退回 1.0.1。
  const tags = ["v1.0.0", "v2.0.0-beta.1"]
  assert.equal(versionOf({ channel: "beta", expected: "", bump: "patch", tags }), "2.0.0-beta.2")
})

test("beta: no tags at all starts from 0.0.1-beta.1", () => {
  assert.equal(versionOf({ channel: "beta", expected: "", bump: "patch", tags: [] }), "0.0.1-beta.1")
})

test("beta: explicit version must be greater than every existing tag", () => {
  const tags = ["v1.0.0", "v1.0.1-beta.3"]
  assert.equal(versionOf({ channel: "beta", expected: "2.0.0-beta.1", bump: "patch", tags }), "2.0.0-beta.1")
  // 等于现有 tag、低于现有 beta、低于现有 stable 都拒绝。
  assert.throws(() => versionOf({ channel: "beta", expected: "1.0.1-beta.3", bump: "patch", tags }))
  assert.throws(() => versionOf({ channel: "beta", expected: "1.0.1-beta.2", bump: "patch", tags }))
  assert.throws(() => versionOf({ channel: "beta", expected: "1.0.0-beta.9", bump: "patch", tags }))
  assert.throws(() => versionOf({ channel: "beta", expected: "1.0.1", bump: "patch", tags }))
})

test("refreshBeta: beta releases always refresh; stable refreshes unless below max beta base", () => {
  assert.equal(shouldRefreshBetaPointer("beta", "1.0.1-beta.1", ["v1.0.0"]), true)
  // 无 beta tag：stable 刷新无害（产物里的 beta*.yml 指向自身）。
  assert.equal(shouldRefreshBetaPointer("stable", "1.0.1", ["v1.0.0"]), true)
  // stable >= 最高 beta 基线：刷新（beta 用户收敛到 stable）。
  assert.equal(shouldRefreshBetaPointer("stable", "1.0.1", ["v1.0.0", "v1.0.1-beta.2"]), true)
  assert.equal(shouldRefreshBetaPointer("stable", "1.1.0", ["v1.0.0", "v1.0.1-beta.2"]), true)
  // stable 低于既存 beta 基线（手动抬过基线后的 hotfix）：跳过，防 beta 指针倒退。
  assert.equal(shouldRefreshBetaPointer("stable", "1.0.5", ["v1.0.0", "v2.0.0-beta.1"]), false)
})

test("computeReleaseVersion returns version + refreshBeta together", () => {
  assert.deepEqual(computeReleaseVersion({ channel: "beta", expected: "", bump: "patch", tags: ["v1.0.0"] }), {
    version: "1.0.1-beta.1",
    refreshBeta: true,
  })
  assert.deepEqual(
    computeReleaseVersion({ channel: "stable", expected: "1.0.5", bump: "patch", tags: ["v1.0.0", "v2.0.0-beta.1"] }),
    { version: "1.0.5", refreshBeta: false },
  )
})

test("formatVersion round-trips", () => {
  assert.equal(formatVersion(parseVersion("1.2.3")!), "1.2.3")
  assert.equal(formatVersion(parseVersion("v1.2.3-beta.10")!), "1.2.3-beta.10")
})
