import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { BillingClient } from "./billing.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

test("subscriptionCheckoutUrl keeps the console subscription page contract", async () => {
  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  const url = new URL(await client.subscriptionCheckoutUrl({ plan: "ai_pro" }))

  assert.equal(url.pathname, "/api/user/subscriptions/page")
  assert.equal(url.searchParams.get("payment_type"), "subscription")
  assert.equal(url.searchParams.get("client_platform"), "chat-web")
  assert.equal(url.searchParams.get("plan"), "ai_pro")
  assert.equal(url.searchParams.get("user_id"), "user-1")
  assert.equal(url.searchParams.get("redirect"), url.searchParams.get("source_page"))
  assert.equal(new URL(url.searchParams.get("redirect") ?? "").pathname, "/billing")
})

test("subscriptionPortalUrl keeps the stripe portal endpoint contract", async () => {
  const requestedUrls: URL[] = []
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
    requestedUrls.push(url)

    const headers = new Headers(init?.headers)
    assert.equal(headers.get("Authorization"), "Bearer oomol-token")
    assert.equal(headers.get("Cookie"), "oomol-token=oomol-token")
    return Response.json({ data: "https://console.example.com/customer-portal", success: true })
  })

  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  assert.equal(await client.subscriptionPortalUrl(), "https://console.example.com/customer-portal")
  assert.equal(requestedUrls.length, 1)
  assert.equal(requestedUrls[0]?.pathname, "/api/stripe/portal")
  assert.equal(requestedUrls[0]?.searchParams.get("product"), "ai")
})
