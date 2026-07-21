import assert from "node:assert/strict"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test, vi } from "vitest"
import { LinkRuntimeManager } from "./node.ts"

function encryption(options: { available?: boolean; backend?: string } = {}) {
  return {
    decryptString: (encrypted: Buffer) => Buffer.from(encrypted.toString("utf8"), "base64").toString("utf8"),
    encryptString: (plainText: string) => Buffer.from(Buffer.from(plainText, "utf8").toString("base64"), "utf8"),
    getSelectedStorageBackend: () => options.backend ?? "gnome_libsecret",
    isEncryptionAvailable: () => options.available ?? true,
  }
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "wanta-link-runtime-"))
}

function healthResponse(): Response {
  return Response.json({ data: { ok: true, runtime: "oomol-connect" } })
}

test("LinkRuntimeManager defaults to OOMOL without writing a migration file", async () => {
  const dir = await temporaryDirectory()
  const manager = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(true),
    platform: "darwin",
  })

  assert.deepEqual(await manager.getState(), {
    active: "oomol",
    availability: { oomol: true, openconnector: false },
    selected: "oomol",
  })
  await assert.rejects(stat(path.join(dir, "link-runtime.json")), { code: "ENOENT" })
})

test("LinkRuntimeManager persists only an origin-bound encrypted token with owner-only permissions", async () => {
  const dir = await temporaryDirectory()
  const manager = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })

  await manager.saveOpenConnector({
    baseUrl: "https://connector.example.test/?ignored=yes#fragment",
    consoleUrl: "https://console.example.test/#settings",
    runtimeToken: " runtime-secret ",
  })
  const state = await manager.selectRuntime("openconnector")

  assert.deepEqual(state, {
    active: "openconnector",
    availability: { oomol: false, openconnector: true },
    openConnector: {
      baseUrl: "https://connector.example.test",
      consoleUrl: "https://console.example.test",
      tokenConfigured: true,
    },
    selected: "openconnector",
  })
  assert.deepEqual(await manager.openConnectorRuntime(), {
    baseUrl: "https://connector.example.test",
    consoleUrl: "https://console.example.test",
    kind: "openconnector",
    runtimeToken: "runtime-secret",
  })
  const file = path.join(dir, "link-runtime.json")
  assert.equal((await readFile(file, "utf8")).includes("runtime-secret"), false)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test("LinkRuntimeManager preserves a token on same-origin edits and requires a replacement for origin changes", async () => {
  const dir = await temporaryDirectory()
  const manager = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://one.example.test", runtimeToken: "first-token" })

  await manager.saveOpenConnector({
    baseUrl: "https://one.example.test/",
    consoleUrl: "https://console.example.test",
  })
  assert.equal((await manager.openConnectorRuntime())?.runtimeToken, undefined)
  await manager.selectRuntime("openconnector")
  assert.equal((await manager.openConnectorRuntime())?.runtimeToken, "first-token")

  await assert.rejects(
    manager.saveOpenConnector({ baseUrl: "https://two.example.test" }),
    /new runtime token or clear the saved token/i,
  )
  assert.equal((await manager.getState()).openConnector?.baseUrl, "https://one.example.test")

  await manager.saveOpenConnector({ baseUrl: "https://two.example.test", runtimeToken: "second-token" })
  assert.equal((await manager.openConnectorRuntime())?.runtimeToken, "second-token")
})

test("LinkRuntimeManager keeps selection while clearing credentials and removing configuration", async () => {
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "http://127.0.0.1:3000", runtimeToken: "secret" })
  await manager.selectRuntime("openconnector")

  const cleared = await manager.clearOpenConnectorToken()
  assert.equal(cleared.selected, "openconnector")
  assert.equal(cleared.active, "openconnector")
  assert.equal(cleared.openConnector?.tokenConfigured, false)

  const removed = await manager.removeOpenConnector()
  assert.equal(removed.selected, "openconnector")
  assert.equal(removed.active, "none")
  assert.equal(removed.openConnector, undefined)
})

test("LinkRuntimeManager treats unreadable and origin-mismatched ciphertext as unavailable", async () => {
  const dir = await temporaryDirectory()
  const manager = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://one.example.test", runtimeToken: "secret" })
  await manager.selectRuntime("openconnector")

  const file = path.join(dir, "link-runtime.json")
  const persisted = JSON.parse(await readFile(file, "utf8")) as {
    openConnector: { encryptedRuntimeToken: string }
  }
  const mismatched = JSON.stringify({
    origin: "https://two.example.test",
    token: "secret",
    version: 1,
  })
  persisted.openConnector.encryptedRuntimeToken = encryption().encryptString(mismatched).toString("base64")
  await writeFile(file, JSON.stringify(persisted), "utf8")

  const state = await manager.getState()
  assert.equal(state.openConnector?.tokenConfigured, true)
  assert.equal(state.availability.openconnector, false)
  assert.equal(state.active, "none")
  assert.equal(await manager.openConnectorRuntime(), null)
})

test("LinkRuntimeManager never sends a saved token after the persisted API origin changes", async () => {
  const dir = await temporaryDirectory()
  const fetchMock = vi.fn(async () => healthResponse())
  const manager = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    fetch: fetchMock as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://one.example.test", runtimeToken: "secret" })
  await manager.selectRuntime("openconnector")

  const file = path.join(dir, "link-runtime.json")
  const persisted = JSON.parse(await readFile(file, "utf8")) as {
    openConnector: { baseUrl: string }
  }
  persisted.openConnector.baseUrl = "https://two.example.test"
  await writeFile(file, JSON.stringify(persisted), "utf8")

  assert.equal((await manager.getState()).active, "none")
  assert.deepEqual(await manager.getOpenConnectorStatus(), { kind: "unknown" })
  await assert.rejects(manager.listOpenConnectorApps(), /credential is unavailable/i)
  assert.equal(fetchMock.mock.calls.length, 0)
})

test("LinkRuntimeManager reports OOMOL availability without overwriting an OpenConnector selection", async () => {
  let oomolAvailable = false
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(oomolAvailable),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://connector.example.test" })
  await manager.selectRuntime("openconnector")

  oomolAvailable = true
  await manager.oomolAvailabilityChanged()

  const state = await manager.getState()
  assert.equal(state.selected, "openconnector")
  assert.equal(state.active, "openconnector")
  assert.deepEqual(state.availability, { oomol: true, openconnector: true })
})

test("LinkRuntimeManager rejects weak credential storage and invalid endpoint paths", async () => {
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption({ backend: "basic_text" }),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "linux",
  })

  await assert.rejects(
    manager.saveOpenConnector({ baseUrl: "https://connector.example.test", runtimeToken: "secret" }),
    /plaintext fallback is disabled/i,
  )
  await assert.rejects(manager.saveOpenConnector({ baseUrl: "https://connector.example.test/v1" }), /only an origin/i)
  await assert.rejects(
    manager.saveOpenConnector({ baseUrl: "https://user:password@connector.example.test" }),
    /must not include credentials/i,
  )
})

test("LinkRuntimeManager distinguishes health outcomes and never forwards a token across origins", async () => {
  const requests: Array<{ authorization: string | null; url: string }> = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ authorization: new Headers(init?.headers).get("authorization"), url })
    if (url.startsWith("https://redirect.example.test")) {
      return new Response(null, { headers: { Location: "https://other.example.test/v1/health" }, status: 307 })
    }
    if (url.startsWith("https://unauthorized.example.test")) return new Response(null, { status: 401 })
    if (url.startsWith("https://unsupported.example.test")) return new Response("not-json")
    return healthResponse()
  })
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    fetch: fetchMock as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })

  assert.deepEqual(
    await manager.testOpenConnector({ baseUrl: "https://online.example.test", runtimeToken: "secret" }),
    { kind: "online" },
  )
  assert.deepEqual(await manager.testOpenConnector({ baseUrl: "https://unauthorized.example.test" }), {
    kind: "unauthorized",
  })
  assert.deepEqual(await manager.testOpenConnector({ baseUrl: "https://unsupported.example.test" }), {
    kind: "incompatible",
    reason: "unsupported-response",
  })
  assert.deepEqual(
    await manager.testOpenConnector({ baseUrl: "https://redirect.example.test", runtimeToken: "secret" }),
    { kind: "incompatible", reason: "not-openconnector" },
  )
  assert.equal(requests.filter((request) => request.url.includes("other.example.test")).length, 0)
  assert.equal(requests.at(-1)?.authorization, "Bearer secret")
})

test("LinkRuntimeManager distinguishes unreachable, TLS, and timeout failures", async () => {
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith("https://tls.example.test")) {
        const error = new TypeError("fetch failed")
        error.cause = { code: "CERT_HAS_EXPIRED" }
        throw error
      }
      if (url.startsWith("https://timeout.example.test")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          })
        })
      }
      throw new TypeError("fetch failed")
    }) as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    healthTimeoutMs: 1,
    platform: "darwin",
  })

  assert.deepEqual(await manager.testOpenConnector({ baseUrl: "https://offline.example.test" }), {
    kind: "offline",
    reason: "unreachable",
  })
  assert.deepEqual(await manager.testOpenConnector({ baseUrl: "https://tls.example.test" }), {
    kind: "offline",
    reason: "tls",
  })
  assert.deepEqual(await manager.testOpenConnector({ baseUrl: "https://timeout.example.test" }), {
    kind: "offline",
    reason: "timeout",
  })
})

test("LinkRuntimeManager follows same-origin health redirects and reuses a saved token only for its origin", async () => {
  const requests: Array<{ authorization: string | null; url: string }> = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ authorization: new Headers(init?.headers).get("authorization"), url })
    if (url === "https://one.example.test/v1/health") {
      return new Response(null, { headers: { Location: "/health/ready" }, status: 307 })
    }
    return healthResponse()
  })
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    fetch: fetchMock as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://one.example.test", runtimeToken: "saved-secret" })

  assert.deepEqual(await manager.testOpenConnector({ baseUrl: "https://one.example.test" }), { kind: "online" })
  assert.deepEqual(requests.slice(0, 2), [
    { authorization: "Bearer saved-secret", url: "https://one.example.test/v1/health" },
    { authorization: "Bearer saved-secret", url: "https://one.example.test/health/ready" },
  ])

  await manager.testOpenConnector({ baseUrl: "https://two.example.test" })
  assert.equal(requests.at(-1)?.authorization, null)
})

test("LinkRuntimeManager merges and caches status checks until configuration changes", async () => {
  let now = 1_000
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fetchMock = vi.fn(async () => {
    await gate
    return healthResponse()
  })
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    fetch: fetchMock as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    healthStatusTtlMs: 10_000,
    now: () => now,
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://connector.example.test" })

  const first = manager.getOpenConnectorStatus()
  const second = manager.getOpenConnectorStatus()
  release?.()
  assert.deepEqual(await Promise.all([first, second]), [
    { checkedAt: 1_000, kind: "online" },
    { checkedAt: 1_000, kind: "online" },
  ])
  assert.equal(fetchMock.mock.calls.length, 1)

  now = 5_000
  await manager.getOpenConnectorStatus()
  assert.equal(fetchMock.mock.calls.length, 1)

  await manager.saveOpenConnector({
    baseUrl: "https://connector.example.test",
    consoleUrl: "https://console.example.test",
  })
  await manager.getOpenConnectorStatus()
  assert.equal(fetchMock.mock.calls.length, 2)
})

test("LinkRuntimeManager normalizes and caches redacted OpenConnector inventory", async () => {
  const requests: Array<{ authorization: string | null; redirect?: RequestRedirect; url: string }> = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      authorization: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      url: String(input),
    })
    return Response.json({
      success: true,
      message: "OK",
      meta: {},
      data: [
        {
          id: "private-id",
          service: "gmail",
          alias: "work",
          authType: "oauth2",
          displayName: "Work Gmail",
          accountLabel: "person@example.test",
          isDefault: true,
          scopes: ["private-scope"],
          status: "active",
        },
      ],
    })
  })
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    fetch: fetchMock as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://connector.example.test", runtimeToken: "runtime-token" })
  await manager.selectRuntime("openconnector")

  const [first, second] = await Promise.all([manager.listOpenConnectorApps(), manager.listOpenConnectorApps()])

  assert.deepEqual(first, [
    {
      accountLabel: "person@example.test",
      authType: "oauth2",
      connectionName: "work",
      displayName: "Work Gmail",
      isDefault: true,
      service: "gmail",
      status: "active",
    },
  ])
  assert.deepEqual(second, first)
  assert.deepEqual(requests, [
    {
      authorization: "Bearer runtime-token",
      redirect: "manual",
      url: "https://connector.example.test/v1/apps",
    },
  ])
  assert.equal(JSON.stringify(first).includes("private-id"), false)
  assert.equal(JSON.stringify(first).includes("private-scope"), false)
})

test("LinkRuntimeManager does not forward inventory credentials across origins", async () => {
  const requests: string[] = []
  const manager = new LinkRuntimeManager({
    dir: await temporaryDirectory(),
    encryption: encryption(),
    fetch: (async (input: string | URL | Request) => {
      requests.push(String(input))
      return new Response(null, { headers: { Location: "https://other.example.test/v1/apps" }, status: 307 })
    }) as typeof fetch,
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await manager.saveOpenConnector({ baseUrl: "https://connector.example.test", runtimeToken: "runtime-token" })
  await manager.selectRuntime("openconnector")

  await assert.rejects(manager.listOpenConnectorApps(), /different origin/i)
  assert.deepEqual(requests, ["https://connector.example.test/v1/apps"])
})

test("LinkRuntimeManager preserves the previous configuration when an atomic write fails", async () => {
  const dir = await temporaryDirectory()
  const initial = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
  })
  await initial.saveOpenConnector({ baseUrl: "https://one.example.test", runtimeToken: "first-secret" })

  const failing = new LinkRuntimeManager({
    dir,
    encryption: encryption(),
    getOomolAvailable: () => Promise.resolve(false),
    platform: "darwin",
    writeText: () => Promise.reject(new Error("write failed")),
  })
  await assert.rejects(
    failing.saveOpenConnector({ baseUrl: "https://one.example.test", runtimeToken: "second-secret" }),
    /write failed/,
  )

  assert.equal((await initial.openConnectorRuntime())?.runtimeToken, undefined)
  await initial.selectRuntime("openconnector")
  assert.equal((await initial.openConnectorRuntime())?.runtimeToken, "first-secret")
})
