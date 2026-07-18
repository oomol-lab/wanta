import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { packageAssetsBaseUrl, registryBaseUrl, searchBaseUrl } from "@/lib/domain"
import {
  clearSkillCatalogCacheForTest,
  listPublicSkillPackages,
  readPublicSkillPackageByName,
  searchPublicSkillPackages,
} from "@/lib/skills-catalog-client"

afterEach(() => {
  clearSkillCatalogCacheForTest()
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

test("searchPublicSkillPackages searches remotely and enriches registry package details", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(`${searchBaseUrl}/v1/packages/-/skills-search`)) {
      return new Response(
        JSON.stringify({
          data: [
            {
              description: "Matched beta skill",
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

    if (url === `${registryBaseUrl}/-/oomol/package-info/%40acme%2Fdemo/1.2.3`) {
      return new Response(
        JSON.stringify({
          icon: "assets/icon.svg",
          packageName: "@acme/demo",
          packageVersion: "1.2.3",
          skills: [
            { name: "alpha", title: "Alpha" },
            { name: "beta", title: "Beta" },
          ],
          title: "Demo Package",
          visibility: "public",
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
  assert.equal(catalog.items[0]?.displayName, "Demo Package")
  assert.equal(catalog.items[0]?.skills[0]?.name, "beta")
  assert.equal(
    catalog.items[0]?.icon,
    `${packageAssetsBaseUrl}/packages/@acme/demo/1.2.3/files/package/assets/icon.svg`,
  )

  const searchUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
  assert.equal(searchUrl.searchParams.get("keywords"), "beta")
  assert.equal(searchUrl.searchParams.get("size"), "100")
})

test("searchPublicSkillPackages falls back when registry info returns a different version", async () => {
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

    if (url === `${registryBaseUrl}/-/oomol/package-info/%40acme%2Fdemo/1.0.0`) {
      return new Response(
        JSON.stringify({
          packageName: "@acme/demo",
          packageVersion: "2.0.0",
          skills: [{ name: "new-skill", title: "New Skill" }],
          title: "Demo Package",
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
})
