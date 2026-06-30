import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { packageAssetsBaseUrl, registryBaseUrl, searchBaseUrl } from "@/lib/domain"
import { searchPublicSkillPackages } from "@/lib/skills-catalog-client.ts"

afterEach(() => {
  vi.unstubAllGlobals()
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

    if (url === `${registryBaseUrl}/-/oomol/package-info/%40acme%2Fdemo/latest`) {
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
