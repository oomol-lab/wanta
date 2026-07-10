import { afterEach, describe, expect, it, vi } from "vitest"
import {
  billingAuthRequiredMessage,
  getBillingOverview,
  getBillingSummary,
  getCreditBalance,
  previewWantaSubscription,
  topUpCheckoutUrl,
  updateWantaSubscription,
} from "./billing-client.ts"
import { OomolHttpError } from "./oomol-http.ts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function rejection(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error("Expected the call to reject, but it resolved.")
}

function urlOf(input: string | URL | Request): URL {
  return new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
}

function stubWantaSubscriptionFetch(data: Record<string, unknown>): { requestBody: () => string } {
  let body = ""
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    expect(urlOf(input).pathname).toBe("/api/user/subscriptions/wanta")
    body = String(init?.body ?? "")
    return Response.json({ data, success: true })
  })
  return { requestBody: () => body }
}

describe("billing-client", () => {
  it("attaches the session cookie via credentials:include and sets no Authorization header", async () => {
    let seenInit: RequestInit | undefined
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      seenInit = init
      return Response.json({ data: "https://console.example.com/checkout", success: true })
    })

    await topUpCheckoutUrl("5_USD")

    expect(seenInit?.credentials).toBe("include")
    // 渲染层既拿不到也不应设置 token：cookie 由 Chromium 自动附带（守 R4）。
    expect(new Headers(seenInit?.headers).get("Authorization")).toBeNull()
    expect(new Headers(seenInit?.headers).get("Cookie")).toBeNull()
  })

  it("maps 401 to the auth-required sentinel and surfaces other statuses generically", async () => {
    let status = 401
    vi.stubGlobal("fetch", async () => new Response("nope", { status }))

    expect((await rejection(() => getCreditBalance())).message).toBe(billingAuthRequiredMessage)

    status = 403
    const error = await rejection(() => getCreditBalance())
    expect(error.message).not.toBe(billingAuthRequiredMessage)
    expect(error).toBeInstanceOf(OomolHttpError)
    expect((error as OomolHttpError).status).toBe(403)
  })

  it("surfaces session expiry even if spend/metering succeed", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      // 仅余额端点 401（会话过期），用量统计照常返回：必须以 auth_required 上抛，不能落到 balance:null 假 $0。
      if (urlOf(input).pathname === "/v1/balance/available") {
        return new Response("unauthorized", { status: 401 })
      }
      return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
    })

    expect((await rejection(() => getBillingSummary(30))).message).toBe(billingAuthRequiredMessage)
  })

  it("includes pending Wanta payment in lightweight billing summaries", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.pathname === "/v1/balance/available") {
        return Response.json({
          data: {
            deficit: "0",
            items: [{ currentCredit: "9", originalCredit: "10", serviceScope: "general" }],
            total: { currentCredit: "9", originalCredit: "10" },
          },
        })
      }
      if (url.pathname === "/v1/stats/billing" || url.pathname === "/v1/stats/metering") {
        return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
      }
      if (url.pathname === "/api/user/subscriptions") {
        return Response.json({
          data: {
            features: [],
            plan: "wanta_plus",
            plans: [],
            platforms: {},
            wanta: { additionalSeats: 0, cached: false, updatedAt: null },
          },
          success: true,
        })
      }
      if (url.pathname === "/api/user/subscriptions/wanta/pending_payment") {
        return Response.json({
          data: {
            additionalSeats: 2,
            amountRemaining: 1200,
            currency: "usd",
            currentPeriodEnd: null,
            invoiceStatus: "open",
            latestInvoiceID: "in-1",
            paymentRequired: true,
            paymentURL: "https://console.example.com/wanta-pay",
            pendingUpdate: true,
            pendingUpdateExpiresAt: null,
            plan: "wanta_plus",
            status: "past_due",
            subscriptionID: "sub-1",
          },
          success: true,
        })
      }
      throw new Error(`Unexpected billing test URL: ${url.pathname}`)
    })

    const summary = await getBillingSummary(30)

    expect(summary.wantaPendingPayment?.paymentURL).toBe("https://console.example.com/wanta-pay")
    expect(summary.wantaPendingPayment?.additionalSeats).toBe(2)
  })

  it("resolves the console top-up checkout URL", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      expect(urlOf(input).pathname).toBe("/api/user/web_top_up_url")
      expect(urlOf(input).searchParams.get("price")).toBe("20_USD")
      return Response.json({ data: "https://console.example.com/checkout", success: true })
    })

    expect(await topUpCheckoutUrl("20_USD")).toBe("https://console.example.com/checkout")
  })

  it("reads wrapped balance payloads for payment-required recovery", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        data: {
          items: [
            { currentCredit: "7.5", originalCredit: "10", serviceScope: "general" },
            { currentCredit: "20", originalCredit: "20", serviceScope: "link" },
          ],
          total: { currentCredit: "27.5", originalCredit: "30" },
        },
      }),
    )

    const result = await getCreditBalance()

    expect(result).toEqual({ balance: "$7.5", hasCredits: true })
  })

  it("posts complete Wanta plan changes", async () => {
    const request = stubWantaSubscriptionFetch({
      additionalSeats: 0,
      currentPeriodEnd: 0,
      paymentURL: "https://console.example.com/wanta-checkout",
      plan: "wanta_plus",
      status: "active",
      subscriptionID: "sub-1",
      targetAdditionalSeats: 0,
      targetPlan: "wanta_plus",
    })

    const result = await updateWantaSubscription({ additional_seats: 0, plan: "wanta_plus" })

    expect(JSON.parse(request.requestBody())).toEqual({ additional_seats: 0, plan: "wanta_plus" })
    expect(result.paymentURL).toBe("https://console.example.com/wanta-checkout")
  })

  it("requests a Wanta plan preview before submission", async () => {
    let body = ""
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      expect(urlOf(input).pathname).toBe("/api/user/subscriptions/wanta/preview")
      body = String(init?.body ?? "")
      return Response.json({
        data: {
          amountDue: 3200,
          changeTiming: "immediate",
          currency: "usd",
          mode: "create",
          targetAdditionalSeats: 0,
          targetPlan: "wanta_plus",
          total: 3200,
        },
        success: true,
      })
    })

    const preview = await previewWantaSubscription({ additional_seats: 0, plan: "wanta_plus" })

    expect(JSON.parse(body)).toEqual({ additional_seats: 0, plan: "wanta_plus" })
    expect(preview).toEqual({
      amountDue: 3200,
      changeTiming: "immediate",
      currency: "usd",
      mode: "create",
      targetAdditionalSeats: 0,
      targetPlan: "wanta_plus",
      total: 3200,
    })
  })

  it("posts Wanta seat changes without plan fields", async () => {
    const request = stubWantaSubscriptionFetch({
      additionalSeats: 1,
      currentPeriodEnd: 0,
      paymentURL: "https://console.example.com/wanta-seat-checkout",
      plan: null,
      status: "active",
      subscriptionID: "sub-1",
      targetAdditionalSeats: 1,
      targetPlan: null,
    })

    const result = await updateWantaSubscription({ additional_seats: 1 })

    expect(JSON.parse(request.requestBody())).toEqual({ additional_seats: 1 })
    expect(result.paymentURL).toBe("https://console.example.com/wanta-seat-checkout")
  })

  it("caps credit usage pagination at 100 pages", async () => {
    const balanceRequests: string[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
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
      return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
    })

    await getBillingSummary(30)

    expect(balanceRequests).toHaveLength(100)
    expect(balanceRequests[0]).toBe("first")
    expect(balanceRequests[99]).toBe("next-99")
  })

  it("stops credit usage pagination when nextToken repeats", async () => {
    const balanceRequests: string[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.pathname === "/v1/balance/available") {
        balanceRequests.push(url.searchParams.get("nextToken") ?? "first")
        return Response.json({
          data: {
            deficit: "0",
            items: [{ currentCredit: "1", originalCredit: "1" }],
            nextToken: "repeat-token",
            total: { currentCredit: "1", originalCredit: "1" },
          },
        })
      }
      return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
    })

    const summary = await getBillingSummary(30)

    expect(summary.balance?.items.length).toBe(2)
    expect(balanceRequests).toEqual(["first", "repeat-token"])
  })

  it("returns core billing data when optional detail requests stall", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.pathname === "/v1/balance/available") {
        return Response.json({
          data: {
            deficit: "0",
            items: [{ currentCredit: "8", originalCredit: "10" }],
            total: { currentCredit: "8", originalCredit: "10" },
          },
        })
      }
      if (url.pathname === "/v1/stats/billing") {
        return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "2" } } })
      }
      if (url.pathname === "/v1/stats/metering") {
        return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 4, totalCredit: "0" } } })
      }
      return new Promise<Response>(() => undefined)
    })

    const overviewPromise = getBillingOverview(30)

    await vi.advanceTimersByTimeAsync(3_000)
    const overview = await overviewPromise

    expect(overview.balance?.total.currentCredit).toBe("8")
    expect(overview.spend?.total.totalCredit).toBe("2")
    expect(overview.metering?.total.eventCount).toBe(4)
    expect(overview.subscription).toBeNull()
  })
})
