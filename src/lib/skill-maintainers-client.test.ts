import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import {
  getSkillMaintainerInvitationUrl,
  getSkillPackageMaintainerDetail,
  inviteSkillPackageMaintainer,
} from "./skill-maintainers-client.ts"
import { apiBaseUrl, consoleBaseUrl, registryBaseUrl } from "@/lib/domain"

afterEach(() => {
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
