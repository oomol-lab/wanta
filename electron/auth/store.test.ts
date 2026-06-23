import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { ooEndpoint } from "../domain.ts"
import { AuthStore, removeAccount, selectAccount, upsertAccount } from "./store.ts"

// 持久化形态：只存 profile（无凭证）。运行时账号额外带会话 token，但写盘时被剥离。
const acmeProfile = { id: "u1", name: "Acme" }
const otherProfile = { id: "u2", name: "Other" }
const acme = { ...acmeProfile, sessionToken: "tok-acme" }
const other = { ...otherProfile, sessionToken: "tok-other" }
const avatarUrl = "https://example.com/avatar.png"

test("upsertAccount inserts, replaces by id, sets current, and never persists the session token", () => {
  let auth = upsertAccount({}, acme)
  assert.deepEqual(auth, { currentId: "u1", accounts: [acmeProfile] })

  // 不同 id 追加为新账号（不互相覆盖），并成为当前账号。
  auth = upsertAccount(auth, other)
  assert.deepEqual(auth.accounts, [acmeProfile, otherProfile])
  assert.equal(auth.currentId, "u2")

  // 同 id 替换（如重新登录拿到新会话 token）：持久化的 profile 不变，token 始终不落盘。
  const renewed = { ...acme, sessionToken: "tok-renewed" }
  auth = upsertAccount(auth, renewed)
  assert.deepEqual(auth.accounts, [acmeProfile, otherProfile])
  assert.equal(auth.currentId, "u1")
})

test("upsertAccount persists the profile (avatar) but strips the runtime sessionToken", () => {
  const auth = upsertAccount({}, { ...acme, avatarUrl })
  assert.deepEqual(auth, { currentId: "u1", accounts: [{ ...acmeProfile, avatarUrl }] })
})

test("selectAccount picks current first, then the first account, else null", () => {
  const auth = upsertAccount(upsertAccount({}, other), acme) // currentId = u1
  assert.deepEqual(selectAccount(auth), acmeProfile)

  // currentId 不命中时回退到第一个账号。
  assert.deepEqual(selectAccount({ ...auth, currentId: "missing" }), otherProfile)

  // 无账号时返回 null。
  assert.equal(selectAccount({}), null)
})

test("removeAccount drops the account and clears dangling currentId", () => {
  const auth = upsertAccount(upsertAccount({}, other), acme) // currentId = u1，两账号
  const removed = removeAccount(auth, acme)
  assert.deepEqual(removed.accounts, [otherProfile])
  // 当前账号 u1 被删，currentId 失效清空。
  assert.equal(removed.currentId, undefined)

  const empty = removeAccount(removed, other)
  assert.deepEqual(empty, { currentId: undefined, accounts: [] })
})

test("AuthStore round-trips and tolerates missing file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-auth-"))
  const store = new AuthStore(dir)
  assert.deepEqual(store.read(), {})
  store.write(upsertAccount({}, acme))
  assert.deepEqual(store.read(), { currentId: "u1", accounts: [acmeProfile] })
})

test("read() migrates legacy multi-endpoint auth.json and strips both endpoint and persisted api-key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-auth-"))
  const otherEndpoint = ooEndpoint === "oomol.com" ? "oomol.dev" : "oomol.com"
  writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({
      currentId: "u1",
      accounts: [
        // 同 uid 在另一 endpoint 的历史行（凭证对当前构建无效）→ 丢弃。
        { id: "u1", name: "Acme", endpoint: otherEndpoint, apiKey: "stale-key" },
        // 与当前构建匹配 → 保留，endpoint 与 apiKey 字段一并剥离。
        { id: "u1", name: "Acme", endpoint: ooEndpoint, apiKey: "live-key" },
        // 仅存在于另一 endpoint 的账号 → 丢弃。
        { id: "u2", name: "Other", endpoint: otherEndpoint, apiKey: "other-key" },
      ],
    }),
  )
  assert.deepEqual(new AuthStore(dir).read(), {
    currentId: "u1",
    accounts: [{ id: "u1", name: "Acme" }],
  })
})

test("read() strips a legacy persisted api-key even without any endpoint field", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-auth-"))
  writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({ currentId: "u1", accounts: [{ id: "u1", name: "Acme", apiKey: "legacy-key" }] }),
  )
  assert.deepEqual(new AuthStore(dir).read(), { currentId: "u1", accounts: [{ id: "u1", name: "Acme" }] })
})

test("purgeLegacy rewrites the on-disk file to remove the long-lived api-key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-auth-"))
  const file = path.join(dir, "auth.json")
  writeFileSync(file, JSON.stringify({ currentId: "u1", accounts: [{ id: "u1", name: "Acme", apiKey: "legacy-key" }] }))

  new AuthStore(dir).purgeLegacy()

  // 磁盘文件本身不再包含 apiKey，且账号资料保留。
  const onDisk = JSON.parse(readFileSync(file, "utf-8")) as { accounts?: Array<Record<string, unknown>> }
  assert.equal(readFileSync(file, "utf-8").includes("legacy-key"), false)
  assert.equal(onDisk.accounts?.[0]?.["apiKey"], undefined)
  assert.equal(onDisk.accounts?.[0]?.["name"], "Acme")
})
