import { afterEach, describe, expect, it, vi } from "vitest"
import {
  billingAuthRequiredMessage,
  billingLogRanges,
  getBillingOverview,
  getBillingSummary,
  getCreditBalance,
  readBillingLogs,
  subscriptionCheckoutUrl,
  subscriptionPortalUrl,
  topUpCheckoutUrl,
  updateWantaSubscription,
  wantaSubscriptionPortalUrl,
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
      return Response.json({ data: "https://console.example.com/customer-portal", success: true })
    })

    await subscriptionPortalUrl()

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

  it("resolves the console top-up checkout URL", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      expect(urlOf(input).pathname).toBe("/api/user/web_top_up_url")
      expect(urlOf(input).searchParams.get("price")).toBe("20_USD")
      return Response.json({ data: "https://console.example.com/checkout", success: true })
    })

    expect(await topUpCheckoutUrl("20_USD")).toBe("https://console.example.com/checkout")
  })

  it("keeps the console subscription page contract (pure URL build with userId)", () => {
    const url = new URL(subscriptionCheckoutUrl("ai_pro", "user-1"))
    expect(url.pathname).toBe("/api/user/subscriptions/page")
    expect(url.searchParams.get("payment_type")).toBe("subscription")
    expect(url.searchParams.get("client_platform")).toBe("chat-web")
    expect(url.searchParams.get("plan")).toBe("ai_pro")
    expect(url.searchParams.get("user_id")).toBe("user-1")
    expect(url.searchParams.get("redirect")).toBe(url.searchParams.get("source_page"))
    expect(new URL(url.searchParams.get("redirect") ?? "").pathname).toBe("/billing")
  })

  it("keeps the stripe portal endpoint contract", async () => {
    const requestedUrls: URL[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      requestedUrls.push(urlOf(input))
      return Response.json({ data: "https://console.example.com/customer-portal", success: true })
    })

    expect(await subscriptionPortalUrl()).toBe("https://console.example.com/customer-portal")
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]?.pathname).toBe("/api/stripe/portal")
    expect(requestedUrls[0]?.searchParams.get("product")).toBe("ai")
  })

  it("posts Wanta plan changes without seat fields", async () => {
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

    const result = await updateWantaSubscription({ plan: "wanta_plus" })

    expect(JSON.parse(request.requestBody())).toEqual({ plan: "wanta_plus" })
    expect(result.paymentURL).toBe("https://console.example.com/wanta-checkout")
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

  it("keeps the Wanta stripe portal endpoint contract", async () => {
    const requestedUrls: URL[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      requestedUrls.push(urlOf(input))
      return Response.json({ data: "https://console.example.com/wanta-portal", success: true })
    })

    expect(await wantaSubscriptionPortalUrl()).toBe("https://console.example.com/wanta-portal")
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]?.pathname).toBe("/api/stripe/portal")
    expect(requestedUrls[0]?.searchParams.get("product")).toBe("wanta")
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

  it("stops billing log pagination when a page repeats", async () => {
    const logPages: string[] = []
    const log = {
      createdAt: Date.UTC(2026, 5, 15),
      debitCredit: "1",
      eventID: "event-1",
      payload: {},
      serviceScope: "all",
      source: "SERVICE_LLM",
      sourceType: "chat",
      subject: "chat",
      traceID: "trace-1",
      userID: "user-1",
    }
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.pathname === "/v1/balance/available") {
        return Response.json({
          data: {
            deficit: "0",
            items: [{ currentCredit: "1", originalCredit: "1" }],
            total: { currentCredit: "1", originalCredit: "1" },
          },
        })
      }
      if (url.pathname === "/v1/logs/billing") {
        logPages.push(url.searchParams.get("page") ?? "")
        return Response.json({ items: [log] })
      }
      if (url.pathname === "/api/user/subscriptions") {
        return Response.json({ data: { features: [], plan: null, plans: [], platforms: {} }, success: true })
      }
      if (url.pathname === "/api/user/subscriptions/schedulers") {
        return Response.json({ data: [], success: true })
      }
      return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
    })

    const overview = await getBillingOverview(30)

    expect(overview.logs.length).toBe(1)
    expect(logPages).toEqual(["1", "2"])
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
    expect(overview.logs).toEqual([])
    expect(overview.subscription).toBeNull()
    expect(overview.schedules).toEqual([])
  })

  it("billingLogRanges splits long record queries into backend-safe windows", () => {
    const dayMs = 24 * 60 * 60 * 1000
    const endTime = Date.UTC(2026, 5, 15)

    expect(billingLogRanges(7, endTime)).toEqual([{ endTime, startTime: endTime - 7 * dayMs }])
    expect(billingLogRanges(90, endTime)).toEqual([
      { endTime, startTime: endTime - 30 * dayMs },
      { endTime: endTime - 30 * dayMs, startTime: endTime - 60 * dayMs },
      { endTime: endTime - 60 * dayMs, startTime: endTime - 90 * dayMs },
    ])
    expect(billingLogRanges(Number.NaN, endTime)).toEqual([{ endTime, startTime: endTime - 30 * dayMs }])
  })

  it("readBillingLogs accepts common response envelope shapes", () => {
    const log = {
      debitCredit: "0.1",
      eventID: "event-1",
      userID: "user-1",
      source: "SERVICE_LLM",
      subject: "oopilot",
      sourceType: "quota",
      serviceScope: "general",
      traceID: "trace-1",
      payload: {},
      createdAt: Date.now(),
    }

    expect(readBillingLogs({ items: [log] })).toEqual([log])
    expect(readBillingLogs({ data: { items: [log] } })).toEqual([log])
    expect(readBillingLogs([log])).toEqual([log])
    expect(readBillingLogs({ records: [log] })).toEqual([log])
    expect(readBillingLogs({ items: [null, log] })).toEqual([log])

    expect(
      readBillingLogs({
        data: {
          list: [
            {
              amount: "0.25",
              eventId: "event-2",
              service: "SERVICE_LLM",
              model: "oopilot",
              service_scope: "general",
              source_type: "quota",
              timestamp: "2026-06-15T00:00:00.000Z",
              traceId: "trace-2",
              userId: "user-1",
            },
          ],
        },
      }),
    ).toEqual([
      {
        createdAt: Date.UTC(2026, 5, 15),
        debitCredit: "0.25",
        eventID: "event-2",
        payload: {},
        serviceScope: "general",
        source: "SERVICE_LLM",
        sourceType: "quota",
        subject: "oopilot",
        traceID: "trace-2",
        userID: "user-1",
      },
    ])
  })
})
