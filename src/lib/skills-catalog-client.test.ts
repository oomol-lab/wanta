import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { packageAssetsBaseUrl, searchBaseUrl } from "@/lib/domain"
import {
  clearSkillCatalogCache,
  listMyPublishedSkillPackages,
  listPublicSkillPackages,
  readPublicSkillPackageByName,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"

afterEach(() => {
  clearSkillCatalogCache()
  vi.unstubAllGlobals()
})

test("public Skill lists share cached and in-flight requests", async () => {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({ data: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })
  })
  vi.stubGlobal("fetch", fetchMock)

  await Promise.all([listPublicSkillPackages(), listPublicSkillPackages()])
  await listPublicSkillPackages()

  assert.equal(fetchMock.mock.calls.length, 1)
})

test("cancellable public Skill consumers still share one underlying request", async () => {
  let resolveResponse: (response: Response) => void = () => undefined
  let networkSignal: AbortSignal | null | undefined
  const fetchMock = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Promise<Response>((resolve) => {
        networkSignal = init?.signal
        resolveResponse = resolve
      }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = listPublicSkillPackages({ signal: firstController.signal })
  const second = listPublicSkillPackages({ signal: secondController.signal })

  await vi.waitFor(() => assert.equal(fetchMock.mock.calls.length, 1))
  firstController.abort(new Error("first caller cancelled"))

  await assert.rejects(first, /first caller cancelled/)
  assert.equal(networkSignal?.aborted, false)
  resolveResponse(Response.json({ data: [] }))
  await second
  assert.equal(fetchMock.mock.calls.length, 1)
})

test("my published Skill pages cap registry detail fanout at 20 packages", async () => {
  const packages = Array.from({ length: 25 }, (_, index) => ({
    name: `@acme/package-${index}`,
    version: "1.0.0",
  }))
  let registryReads = 0
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === "/v1/packages/-/my") {
      return Response.json({ data: packages })
    }
    if (url.pathname.startsWith("/-/oomol/package-info/")) {
      registryReads += 1
      const packageName = decodeURIComponent(url.pathname.split("/").at(-2) ?? "")
      return Response.json({
        packageName,
        packageVersion: "1.0.0",
        skills: [{ name: `${packageName}-skill` }],
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)

  const result = await listMyPublishedSkillPackages({ account: { id: "user-1", name: "Alice" } })

  const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
  assert.equal(requestUrl.searchParams.get("size"), "20")
  assert.equal(registryReads, 20)
  assert.equal(result.items.length, 20)
})

test("force refresh supersedes an older pending request and prevents stale cache writes", async () => {
  let resolveFirst: ((response: Response) => void) | undefined
  const firstResponse = new Promise<Response>((resolve) => {
    resolveFirst = resolve
  })
  const fetchMock = vi
    .fn<() => Promise<Response>>()
    .mockImplementationOnce(() => firstResponse)
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ name: "new", skills: [{ name: "new-skill" }] }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
  vi.stubGlobal("fetch", fetchMock)

  const staleRequest = listPublicSkillPackages()
  const freshCatalog = await listPublicSkillPackages({ forceRefresh: true })
  resolveFirst?.(
    new Response(JSON.stringify({ data: [{ name: "old", skills: [{ name: "old-skill" }] }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  )
  const staleCatalog = await staleRequest
  const cachedCatalog = await listPublicSkillPackages()

  assert.equal(fetchMock.mock.calls.length, 2)
  assert.equal(freshCatalog.items[0]?.name, "new")
  assert.equal(staleCatalog.items[0]?.name, "old")
  assert.equal(cachedCatalog.items[0]?.name, "new")
})

test("exact public package lookups reuse the shared package detail cache", async () => {
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        packageName: "@acme/demo",
        packageVersion: "1.2.3",
        skills: [{ name: "demo", title: "Demo" }],
        title: "Demo Package",
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    )
  })
  vi.stubGlobal("fetch", fetchMock)

  await Promise.all([readPublicSkillPackageByName("@acme/demo"), readPublicSkillPackageByName("@acme/demo")])
  await readPublicSkillPackageByName("@acme/demo")

  assert.equal(fetchMock.mock.calls.length, 1)
})

test("searchPublicSkillPackages renders search results without per-package registry requests", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(`${searchBaseUrl}/v1/packages/-/skills-search`)) {
      return new Response(
        JSON.stringify({
          data: [
            {
              description: "Matched beta skill",
              icon: "assets/icon.svg",
              name: "beta",
              owner: "owner-id",
              packageName: "@acme/demo",
              packageVersion: "1.2.3",
              title: "Beta",
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)

  const catalog = await searchPublicSkillPackages({ query: " beta " })

  assert.equal(catalog.items.length, 1)
  assert.equal(catalog.items[0]?.name, "@acme/demo")
  assert.equal(catalog.items[0]?.displayName, "Beta")
  assert.equal(catalog.items[0]?.skills[0]?.name, "beta")
  assert.equal(
    catalog.items[0]?.icon,
    `${packageAssetsBaseUrl}/packages/@acme/demo/1.2.3/files/package/assets/icon.svg`,
  )

  const searchUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
  assert.equal(searchUrl.searchParams.get("keywords"), "beta")
  assert.equal(searchUrl.searchParams.get("size"), "100")
  assert.equal(fetchMock.mock.calls.length, 1)
})

test("searchPublicSkillPackages builds fallback package details from the search result", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(`${searchBaseUrl}/v1/packages/-/skills-search`)) {
      return new Response(
        JSON.stringify({
          data: [
            {
              description: "Matched old skill",
              icon: "assets/search-icon.svg",
              name: "old-skill",
              packageName: "@acme/demo",
              packageVersion: "1.0.0",
              title: "Old Skill",
              visibility: "public",
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)

  const catalog = await searchPublicSkillPackages({ query: "old" })

  assert.equal(catalog.items[0]?.version, "1.0.0")
  assert.equal(catalog.items[0]?.skills[0]?.name, "old-skill")
  assert.equal(
    catalog.items[0]?.icon,
    `${packageAssetsBaseUrl}/packages/@acme/demo/1.0.0/files/package/assets/search-icon.svg`,
  )
  assert.equal(fetchMock.mock.calls.length, 1)
})

test("my published records with skill metadata skip all detail requests", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      data: Array.from({ length: 20 }, (_, i) => ({
        name: `@acme/skill-${i}`,
        version: "2.0.0",
        skills: [{ name: `skill-${i}` }],
      })),
    }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const result = await listMyPublishedSkillPackages({ account: { id: "a", name: "Alice" } })
  assert.equal(result.items.length, 20)
  assert.equal(fetchMock.mock.calls.length, 1)
})

test("failed supplemental details reject the page and are not cached as a successful empty list", async () => {
  let failed = true
  let listReads = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/packages/-/my")) {
        listReads++
        return Response.json({ data: [{ name: "@acme/demo", version: "1.0.0" }] })
      }
      return failed
        ? new Response("unavailable", { status: 503 })
        : Response.json({
            packageName: "@acme/demo",
            packageVersion: "1.0.0",
            skills: [{ name: "demo" }],
          })
    }),
  )
  const account = { id: "a", name: "Alice" }
  await assert.rejects(listMyPublishedSkillPackages({ account }), /503/)
  failed = false
  const recovered = await listMyPublishedSkillPackages({ account })
  assert.equal(recovered.items.length, 1)
  assert.equal(listReads, 2)
})

test("my published force refresh also refreshes supplemental detail at the listed version", async () => {
  let details = 0
  const detailUrls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/packages/-/my"))
        return Response.json({ data: [{ name: "@acme/demo", version: "2.0.0" }] })
      details++
      detailUrls.push(String(input))
      return Response.json({
        packageName: "@acme/demo",
        packageVersion: "2.0.0",
        title: `Title ${details}`,
        skills: [{ name: "demo" }],
      })
    }),
  )
  const account = { id: "a", name: "Alice" }
  await listMyPublishedSkillPackages({ account })
  const result = await listMyPublishedSkillPackages({ account, forceRefresh: true })
  assert.equal(details, 2)
  assert.equal(result.items[0]?.displayName, "Title 2")
  assert.ok(detailUrls.every((url) => url.endsWith("/2.0.0")))
})

test("private details are isolated by account and legitimate non-skill packages are excluded", async () => {
  let details = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/packages/-/my")) return Response.json({ data: [{ name: "@acme/demo" }] })
      details++
      return Response.json({ packageName: "@acme/demo", skills: details === 1 ? [] : [{ name: "demo" }] })
    }),
  )
  assert.equal((await listMyPublishedSkillPackages({ account: { id: "a", name: "A" } })).items.length, 0)
  assert.equal((await listMyPublishedSkillPackages({ account: { id: "b", name: "B" } })).items.length, 1)
  assert.equal(details, 2)
})
