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
  const applyAccount = vi.fn(async () => undefined)
  const emitted: string[] = []
  const manager = new AuthManager({
    applyAccount,
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
  manager.bindStateEmitter(async (state) => {
    emitted.push(`${state.status}:${state.account?.id ?? "local"}`)
  })
  vi.spyOn(console, "error").mockImplementation(() => undefined)

  assert.equal(await manager.completeBrowserLoginCallback("wanta://signin?authID=auth-1"), true)

  assert.deepEqual(store.value(), previous)
  assert.equal(cookie, "old-token")
  assert.deepEqual(emitted, ["unauthenticated:local", "authenticated:old"])
  assert.equal(applyAccount.mock.calls.length, 0)
})

test("expired sessions stay unauthenticated when cookie cleanup fails", async () => {
  const store = memoryStore({ accounts: [{ id: "one", name: "Account one" }], currentId: "one" })
  const applyAccount = vi.fn(async () => undefined)
  const manager = new AuthManager({
    applyAccount,
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => {
        throw new Error("cookie cleanup failed")
      },
      confirmLogin: async () => true,
      exchangeLogin: async () => account("one"),
      openExternal: async () => undefined,
      persistCookie: async () => undefined,
      readCookie: async () => "stale-token",
    },
  })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)

  const state = await manager.expireSession()
  const repeatedState = await manager.expireSession()

  assert.equal(state.status, "unauthenticated")
  assert.equal(repeatedState.status, "unauthenticated")
  assert.equal(await manager.currentSessionToken(), undefined)
  assert.equal(await manager.activeRuntimeAccount(), null)
  assert.deepEqual(store.value(), { accounts: [{ id: "one", name: "Account one" }], currentId: "one" })
  assert.deepEqual(applyAccount.mock.calls, [[null]])
})

test("logout never exposes a stale cookie after cleanup fails", async () => {
  const store = memoryStore({ accounts: [{ id: "one", name: "Account one" }], currentId: "one" })
  const manager = new AuthManager({
    applyAccount: vi.fn(async () => undefined),
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => {
        throw new Error("cookie cleanup failed")
      },
      confirmLogin: async () => true,
      exchangeLogin: async () => account("one"),
      openExternal: async () => undefined,
      persistCookie: async () => undefined,
      readCookie: async () => "stale-token",
    },
  })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)

  const state = await manager.logout()

  assert.equal(state.status, "unauthenticated")
  assert.equal(await manager.currentSessionToken(), undefined)
  assert.equal(await manager.activeRuntimeAccount(), null)
  assert.deepEqual(store.value(), { accounts: [], currentId: undefined })
})

test("logout revokes the cookie before applying local runtime and does so without a stored profile", async () => {
  const events: string[] = []
  const manager = new AuthManager({
    applyAccount: async (next) => {
      events.push(`apply:${next?.id ?? "local"}`)
    },
    protocolScheme: "wanta",
    store: memoryStore(),
    runtime: {
      clearCookies: async () => {
        events.push("clear-cookie")
      },
      confirmLogin: async () => true,
      exchangeLogin: async () => account("one"),
      openExternal: async () => undefined,
      persistCookie: async () => undefined,
      readCookie: async () => "orphaned-token",
    },
  })
  manager.bindStateEmitter(async (state) => {
    events.push(`state:${state.status}`)
  })

  const state = await manager.logout()

  assert.equal(state.status, "unauthenticated")
  assert.deepEqual(events, ["state:unauthenticated", "clear-cookie", "apply:local"])
})

test("session expiry broadcasts signed-out state even when local runtime fallback fails", async () => {
  const store = memoryStore({ accounts: [{ id: "one", name: "Account one" }], currentId: "one" })
  const emitted: string[] = []
  const manager = new AuthManager({
    applyAccount: async () => {
      throw new Error("runtime fallback failed")
    },
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => undefined,
      confirmLogin: async () => true,
      exchangeLogin: async () => account("one"),
      openExternal: async () => undefined,
      persistCookie: async () => undefined,
      readCookie: async () => "expired-token",
    },
  })
  manager.bindStateEmitter(async (state) => {
    emitted.push(state.status)
  })
  vi.spyOn(console, "error").mockImplementation(() => undefined)

  const state = await manager.expireSession()

  assert.equal(state.status, "unauthenticated")
  assert.deepEqual(emitted, ["unauthenticated"])
  assert.deepEqual(store.value(), { accounts: [{ id: "one", name: "Account one" }], currentId: "one" })
  assert.equal(await manager.activeRuntimeAccount(), null)
})

test("account switching leaves the old cloud scope before replacing its cookie and runtime", async () => {
  const store = memoryStore({ accounts: [{ id: "old", name: "Old" }], currentId: "old" })
  const events: string[] = []
  let cookie: string | undefined = "token-old"
  const manager = new AuthManager({
    applyAccount: async (next) => {
      events.push(`apply:${next?.id ?? "local"}`)
    },
    protocolScheme: "wanta",
    store,
    runtime: {
      clearCookies: async () => {
        cookie = undefined
        events.push("clear-cookie")
      },
      confirmLogin: async () => true,
      exchangeLogin: async () => account("new"),
      openExternal: async () => undefined,
      persistCookie: async (token) => {
        cookie = token
        events.push(`persist:${token}`)
      },
      readCookie: async () => cookie,
    },
  })
  manager.bindStateEmitter(async (state) => {
    events.push(`state:${state.status}:${state.account?.id ?? "local"}`)
  })

  assert.equal(await manager.completeBrowserLoginCallback("wanta://signin?authID=auth-new"), true)

  assert.deepEqual(events, ["state:unauthenticated:local", "persist:token-new", "apply:new", "state:authenticated:new"])
  assert.equal(cookie, "token-new")
  assert.deepEqual(store.value(), {
    accounts: [
      { id: "old", name: "Old" },
      { id: "new", name: "Account new" },
    ],
    currentId: "new",
  })
})
