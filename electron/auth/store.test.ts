import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { ooEndpoint } from "../domain.ts"
import { AuthStore, removeAccount, selectAccount, upsertAccount } from "./store.ts"

const acme = { id: "u1", name: "Acme", apiKey: "key-prod" }
const other = { id: "u2", name: "Other", apiKey: "key-other" }

test("upsertAccount inserts, replaces by id, and sets current", () => {
  let auth = upsertAccount({}, acme)
  assert.deepEqual(auth, { currentId: "u1", accounts: [acme] })

  // 不同 id 追加为新账号（不互相覆盖），并成为当前账号。
  auth = upsertAccount(auth, other)
  assert.deepEqual(auth.accounts, [acme, other])
  assert.equal(auth.currentId, "u2")

  // 同 id 替换（如重新登录拿到新 key）。
  const renewed = { ...acme, apiKey: "key-renewed" }
  auth = upsertAccount(auth, renewed)
  assert.deepEqual(auth.accounts, [renewed, other])
  assert.equal(auth.currentId, "u1")
})

test("selectAccount picks current first, then the first account, else null", () => {
  const auth = upsertAccount(upsertAccount({}, other), acme) // currentId = u1
  assert.deepEqual(selectAccount(auth), acme)

  // currentId 不命中时回退到第一个账号。
  assert.deepEqual(selectAccount({ ...auth, currentId: "missing" }), other)

  // 无账号时返回 null。
  assert.equal(selectAccount({}), null)
})

test("removeAccount drops the account and clears dangling currentId", () => {
  const auth = upsertAccount(upsertAccount({}, other), acme) // currentId = u1，两账号
  const removed = removeAccount(auth, acme)
  assert.deepEqual(removed.accounts, [other])
  // 当前账号 u1 被删，currentId 失效清空。
  assert.equal(removed.currentId, undefined)

  const empty = removeAccount(removed, other)
  assert.deepEqual(empty, { currentId: undefined, accounts: [] })
})

test("AuthStore round-trips and tolerates missing file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-auth-"))
  const store = new AuthStore(dir)
  assert.deepEqual(store.read(), {})
  store.write(upsertAccount({}, acme))
  assert.deepEqual(store.read(), { currentId: "u1", accounts: [acme] })
})

test("read() migrates legacy multi-endpoint auth.json: drops other-endpoint rows, strips endpoint field", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-auth-"))
  const otherEndpoint = ooEndpoint === "oomol.com" ? "oomol.dev" : "oomol.com"
  writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({
      currentId: "u1",
      accounts: [
        // 同 uid 在另一 endpoint 的历史行（凭证对当前构建无效）→ 丢弃。
        { id: "u1", name: "Acme", endpoint: otherEndpoint, apiKey: "stale-key" },
        // 与当前构建匹配 → 保留，endpoint 字段剥离。
        { id: "u1", name: "Acme", endpoint: ooEndpoint, apiKey: "live-key" },
        // 仅存在于另一 endpoint 的账号 → 丢弃。
        { id: "u2", name: "Other", endpoint: otherEndpoint, apiKey: "other-key" },
      ],
    }),
  )
  assert.deepEqual(new AuthStore(dir).read(), {
    currentId: "u1",
    accounts: [{ id: "u1", name: "Acme", apiKey: "live-key" }],
  })
})
