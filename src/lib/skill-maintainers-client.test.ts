import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import {
  getSkillMaintainerInvitationUrl,
  getSkillPackageMaintainerDetail,
  inviteSkillPackageMaintainer,
} from "./skill-maintainers-client.ts"
import { apiBaseUrl, consoleBaseUrl, registryBaseUrl } from "@/lib/domain"
import { clearSkillCatalogCache } from "@/lib/skill-catalog-cache"

afterEach(() => {
  clearSkillCatalogCache()
  vi.unstubAllGlobals()
})

test("reads scoped package maintainer details without encoding its path separator", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    Response.json({
      maintainers: [
        { id: "owner-id", name: "Owner", url: "https://example.com/owner.png" },
        { id: "", name: "Invalid" },
      ],
    }),
  )
  vi.stubGlobal("fetch", fetchMock)

  const detail = await getSkillPackageMaintainerDetail({ packageName: "@acme/demo", version: "1.2.3" })

  assert.equal(String(fetchMock.mock.calls[0]?.[0]), `${registryBaseUrl}/-/oomol/detail/@acme/demo/1.2.3`)
  assert.deepEqual(detail.maintainers, [{ id: "owner-id", name: "Owner", url: "https://example.com/owner.png" }])
})

test("creates scoped package maintainer invitations with an encoded username", async () => {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }),
  )
  vi.stubGlobal("fetch", fetchMock)

  await inviteSkillPackageMaintainer({ packageName: "@acme/demo", username: "alice@example.com" })

  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    `${apiBaseUrl}/v1/users/packages/@acme/demo/maintainers/alice%40example.com/invitation`,
  )
  assert.equal(fetchMock.mock.calls[0]?.[1]?.method, "POST")
  assert.equal(fetchMock.mock.calls[0]?.[1]?.credentials, "include")
})

test("builds the Console invitation URL from the initiating user and package", () => {
  assert.equal(
    getSkillMaintainerInvitationUrl({ fromUsername: "owner", packageName: "@acme/demo" }),
    `${consoleBaseUrl}/skill-maintainer-invitation?package=%40acme%2Fdemo&from=owner`,
  )
})

test("maintainer reads share a short-lived account cache, while force refresh and invitations invalidate it", async () => {
  const fetchMock = vi.fn(async () => Response.json({ maintainers: [{ id: "owner", name: "Owner" }] }))
  vi.stubGlobal("fetch", fetchMock)
  const input = { accountId: "a", packageName: "@acme/demo", version: "1.0.0" }
  await Promise.all([getSkillPackageMaintainerDetail(input), getSkillPackageMaintainerDetail(input)])
  await getSkillPackageMaintainerDetail(input)
  assert.equal(fetchMock.mock.calls.length, 1)
  await getSkillPackageMaintainerDetail({ ...input, accountId: "b" })
  assert.equal(fetchMock.mock.calls.length, 2)
  await getSkillPackageMaintainerDetail({ ...input, forceRefresh: true })
  assert.equal(fetchMock.mock.calls.length, 3)
  await inviteSkillPackageMaintainer({ packageName: input.packageName, username: "alice" })
  await getSkillPackageMaintainerDetail(input)
  assert.equal(fetchMock.mock.calls.length, 5)
})
