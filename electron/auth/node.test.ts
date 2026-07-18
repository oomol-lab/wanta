import type { AuthRuntimeAccount, AuthStore, PersistedAuth } from "./store.ts"

import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vitest"

const electronMocks = vi.hoisted(() => ({
  app: { whenReady: vi.fn(async () => undefined) },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  shell: { openExternal: vi.fn(async () => undefined) },
}))

vi.mock("electron", () => electronMocks)

import { AuthManager } from "./node.ts"

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function memoryStore(initial: PersistedAuth = {}): AuthStore & { value: () => PersistedAuth } {
  let persisted = structuredClone(initial)
  return {
    read: () => structuredClone(persisted),
    write: (value) => {
      persisted = structuredClone(value)
    },
    value: () => structuredClone(persisted),
  } as AuthStore & { value: () => PersistedAuth }
}

function account(id: string): AuthRuntimeAccount {
  return { id, name: `Account ${id}`, sessionToken: `token-${id}` }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

test("logout cancels an in-flight browser login before it can adopt the account", async () => {
  const exchange = deferred<AuthRuntimeAccount>()
  const store = memoryStore()
  let cookie: string | undefined
  const confirmLogin = vi.fn(async () => true)
  const manager = new AuthManager({
    applyAccount: vi.fn(async () => undefined),
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => {
        cookie = undefined
      },
      confirmLogin,
      exchangeLogin: async () => exchange.promise,
      openExternal: async () => undefined,
      persistCookie: async (token) => {
        cookie = token
      },
      readCookie: async () => cookie,
    },
  })

  const login = manager.login()
  const loginRejected = assert.rejects(login, { message: "Sign-in was cancelled." })
  const callback = manager.completeBrowserLoginCallback("wanta://signin?authID=auth-1")
  await manager.logout()
  exchange.resolve(account("one"))

  await loginRejected
  assert.equal(await callback, true)
  assert.deepEqual(store.value(), {})
  assert.equal(cookie, undefined)
  assert.equal(confirmLogin.mock.calls.length, 0)
})

test("a pending browser login still requires explicit account confirmation", async () => {
  const store = memoryStore()
  let cookie: string | undefined
  const manager = new AuthManager({
    applyAccount: vi.fn(async () => undefined),
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => {
        cookie = undefined
      },
      confirmLogin: async () => false,
      exchangeLogin: async () => account("one"),
      openExternal: async () => undefined,
      persistCookie: async (token) => {
        cookie = token
      },
      readCookie: async () => cookie,
    },
  })

  const login = manager.login()
  const loginRejected = assert.rejects(login, { message: "Sign-in was cancelled." })
  assert.equal(await manager.completeBrowserLoginCallback("wanta://signin?authID=auth-1"), true)

  await loginRejected
  assert.deepEqual(store.value(), {})
  assert.equal(cookie, undefined)
})

test("cookie persistence failure rolls the account profile back", async () => {
  const previous = { accounts: [{ id: "old", name: "Old" }], currentId: "old" }
  const store = memoryStore(previous)
  let cookie: string | undefined = "old-token"
  const manager = new AuthManager({
    applyAccount: vi.fn(async () => undefined),
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => {
        cookie = undefined
      },
      confirmLogin: async () => true,
      exchangeLogin: async () => account("new"),
      openExternal: async () => undefined,
      persistCookie: async (token) => {
        if (token === "token-new") throw new Error("cookie write failed")
        cookie = token
      },
      readCookie: async () => cookie,
    },
  })
  vi.spyOn(console, "error").mockImplementation(() => undefined)

  assert.equal(await manager.completeBrowserLoginCallback("wanta://signin?authID=auth-1"), true)

  assert.deepEqual(store.value(), previous)
  assert.equal(cookie, "old-token")
})
