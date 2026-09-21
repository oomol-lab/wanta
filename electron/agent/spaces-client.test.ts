import { expect, test, vi } from "vitest"
import { z } from "zod"
import { SpacesClient } from "./spaces-client.ts"

test("Spaces never follows a redirect carrying the Wanta account token", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.redirect).toBe("error")
    throw new TypeError("redirect forbidden")
  })
  const client = new SpacesClient({ accountId: "a", token: "account-secret", teamName: "team" }, fetcher)
  await expect(client.get("demo")).rejects.toThrow("outcome may be unknown")
  expect(fetcher).toHaveBeenCalledOnce()
})

test("missing team and missing write idempotency fail before any network request", async () => {
  const fetcher = vi.fn<typeof fetch>()
  const identity = { accountId: "a", token: "account-secret", teamName: "" }
  await expect(new SpacesClient(identity, fetcher).get("demo")).rejects.toThrow("explicit team")
  await expect(
    new SpacesClient({ ...identity, teamName: "team" }, fetcher).request("POST", "/v1/spaces", z.object({})),
  ).rejects.toThrow("idempotency")
  expect(fetcher).not.toHaveBeenCalled()
})

test("upstream diagnostics cannot echo credentials into tool errors", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ code: "insufficient_balance", message: "account-secret" }, { status: 402 }),
  )
  const client = new SpacesClient({ accountId: "a", token: "account-secret", teamName: "team" }, fetcher)
  await expect(client.get("demo")).rejects.toThrow("insufficient_balance (HTTP 402)")
  try {
    await client.get("demo")
  } catch (error) {
    expect(String(error)).not.toContain("account-secret")
  }
})
