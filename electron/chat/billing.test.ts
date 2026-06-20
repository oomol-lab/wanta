import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { billingAuthRequiredMessage, BillingClient } from "./billing.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("Expected the call to reject, but it resolved.")
}

test("billing reads throw the auth-required sentinel when the session token is missing", async () => {
  const client = new BillingClient()
  // 会话过期后 userId 仍在（来自 auth.json），token 缺失：必须抛错而非返回空成功的 balance:null。
  client.setAccountContext({ token: undefined, userId: "user-1" })

  assert.equal(await rejectionMessage(() => client.getBillingSummary({ days: 30 })), billingAuthRequiredMessage)
  assert.equal(await rejectionMessage(() => client.getBillingOverview({ days: 30 })), billingAuthRequiredMessage)
  assert.equal(await rejectionMessage(() => client.getCreditBalance()), billingAuthRequiredMessage)
})

test("getCreditBalance maps 401 to the auth-required sentinel but leaves other statuses generic", async () => {
  let status = 401
  vi.stubGlobal("fetch", async () => new Response("nope", { status }))
  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  assert.equal(await rejectionMessage(() => client.getCreditBalance()), billingAuthRequiredMessage)

  status = 403
  assert.equal(await rejectionMessage(() => client.getCreditBalance()), "Failed to get credit balance: 403")
})

test("getBillingSummary surfaces session expiry even if spend/metering succeed", async () => {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
    // 仅余额端点 401（会话过期），用量统计照常返回：必须以 auth_required 上抛，不能落到 balance:null 假 $0。
    if (url.pathname === "/v1/balance/available") {
      return new Response("unauthorized", { status: 401 })
    }
    return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
  })
  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  assert.equal(await rejectionMessage(() => client.getBillingSummary({ days: 30 })), billingAuthRequiredMessage)
})

test("getBillingSummary never serves stale cache after the session expires", async () => {
  let unauthorized = false
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
    if (unauthorized) {
      return new Response("unauthorized", { status: 401 })
    }
    if (url.pathname === "/v1/balance/available") {
      return Response.json({
        data: {
          deficit: "0",
          items: [{ currentCredit: "5", originalCredit: "5" }],
          total: { currentCredit: "5", originalCredit: "5" },
        },
      })
    }
    return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
  })
  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  const fresh = await client.getBillingSummary({ days: 30 })
  assert.equal(fresh.balance?.total.currentCredit, "5")

  // 会话过期后强制刷新：绝不能用旧缓存兜底（accountKey 不变），必须抛 auth_required 触发重新登录提示。
  unauthorized = true
  assert.equal(
    await rejectionMessage(() => client.getBillingSummary({ days: 30, forceRefresh: true })),
    billingAuthRequiredMessage,
  )
})

test("topUpCheckoutUrl falls back to the billing page (no throw) when the session token is missing", async () => {
  const client = new BillingClient()
  client.setAccountContext({ token: undefined, userId: "user-1" })

  const url = new URL(await client.topUpCheckoutUrl({ price: "20_USD" }))

  assert.equal(url.pathname, "/billing")
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

test("getCreditBalance uses the billing request timeout", async () => {
  let requestSignal: AbortSignal | undefined
  vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal instanceof AbortSignal ? init.signal : undefined
    return Response.json({
      items: [{ currentCredit: "2", originalCredit: "2" }],
      total: { currentCredit: "2", originalCredit: "2" },
    })
  })

  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  const balance = await client.getCreditBalance()

  assert.equal(balance.hasCredits, true)
  assert.equal(requestSignal instanceof AbortSignal, true)
})

test("getBillingSummary caps credit usage pagination", async () => {
  const balanceRequests: string[] = []
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
    if (url.pathname === "/v1/balance/available") {
      balanceRequests.push(url.searchParams.get("nextToken") ?? "first")
      return Response.json({
        data: {
          deficit: "0",
          items: [{ currentCredit: "1", originalCredit: "1" }],
          nextToken: `next-${balanceRequests.length}`,
          total: { currentCredit: "1", originalCredit: "1" },
        },
      })
    }
    if (url.pathname === "/v1/stats/billing" || url.pathname === "/v1/stats/metering") {
      return Response.json({
        data: {
          items: [],
          sourceTotals: {},
          total: { eventCount: 0, totalCredit: "0", totalUsage: "0" },
        },
      })
    }
    throw new Error(`Unexpected billing endpoint: ${url.pathname}`)
  })

  const client = new BillingClient()
  client.setAccountContext({ token: "oomol-token", userId: "user-1" })

  await client.getBillingSummary({ days: 30 })

  assert.equal(balanceRequests.length, 100)
  assert.equal(balanceRequests[0], "first")
  assert.equal(balanceRequests[99], "next-99")
})
