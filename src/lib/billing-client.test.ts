import { afterEach, describe, expect, it, vi } from "vitest"
import {
  billingAuthRequiredMessage,
  getBillingOverview,
  getCreditBalance,
  previewTeamSubscription,
  topUpCheckoutUrl,
  updateTeamSubscription,
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

const teamScope = {
  canManageFunding: true,
  canManageTeamSubscription: true,
  canReadTeamSubscription: true,
  teamId: "team-1",
  teamName: "acme",
} as const

function stubTeamSubscriptionFetch(data: Record<string, unknown>): { requestBody: () => string } {
  let body = ""
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    expect(urlOf(input).pathname).toBe("/api/team/team-1/subscriptions/team")
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

    expect((await rejection(() => getCreditBalance(teamScope))).message).toBe(billingAuthRequiredMessage)

    status = 403
    const error = await rejection(() => getCreditBalance(teamScope))
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

    expect((await rejection(() => getBillingOverview(30, teamScope))).message).toBe(billingAuthRequiredMessage)
  })

  it("scopes team billing reads, skips retired usage subscriptions, and includes pending Team payment", async () => {
    const paths: string[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input)
      paths.push(url.pathname)
      if (url.pathname === "/v1/balance/available") {
        expect(new Headers(init?.headers).get("x-oo-organization-name")).toBeNull()
      } else if (url.hostname === "insight.oomol.com") {
        // Team usage now scopes via the /v2/stats/team/:teamId/* path, not the legacy org-name header.
        expect(new Headers(init?.headers).get("x-oo-organization-name")).toBeNull()
        expect(url.pathname).toMatch(/^\/v2\/stats\/team\/team-1\/(billing|metering)$/)
      }
      if (url.pathname === "/v1/balance/available") {
        return Response.json({
          data: {
            deficit: "0",
            items: [{ currentCredit: "9", originalCredit: "10", serviceScope: "general" }],
            total: { currentCredit: "9", originalCredit: "10" },
          },
        })
      }
      if (url.pathname === "/v2/stats/team/team-1/billing" || url.pathname === "/v2/stats/team/team-1/metering") {
        return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
      }
      if (url.pathname === "/api/org/team-1/subscriptions") {
        return Response.json({
          data: {
            features: [],
            plan: "team_plus",
            plans: [],
            platforms: {},
            team: { additionalSeats: 0, cached: false, updatedAt: null },
          },
          success: true,
        })
      }
      if (url.pathname === "/api/team/team-1/subscriptions/team/pending_payment") {
        return Response.json({
          data: {
            additionalSeats: 2,
            amountRemaining: 1200,
            currency: "usd",
            currentPeriodEnd: null,
            invoiceStatus: "open",
            latestInvoiceID: "in-1",
            paymentRequired: true,
            paymentURL: "https://console.example.com/team-pay",
            pendingUpdate: true,
            pendingUpdateExpiresAt: null,
            plan: "team_plus",
            status: "past_due",
            subscriptionID: "sub-1",
          },
          success: true,
        })
      }
      throw new Error(`Unexpected billing test URL: ${url.pathname}`)
    })

    const summary = await getBillingOverview(30, {
      canManageFunding: true,
      canManageTeamSubscription: true,
      canReadTeamSubscription: true,
      teamId: "team-1",
      teamName: "acme",
    })

    expect(summary.teamPendingPayment?.paymentURL).toBe("https://console.example.com/team-pay")
    expect(summary.teamPendingPayment?.additionalSeats).toBe(2)
    expect(summary.subscription?.plan).toBe("team_plus")
    expect(summary.subscriptionAvailable).toBe(true)
    expect(paths).not.toContain("/api/user/subscriptions")
  })

  it("does not request team subscriptions for members without billing permission", async () => {
    const paths: string[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      paths.push(url.pathname)
      if (url.pathname === "/v1/balance/available") {
        return Response.json({ data: { items: [], total: { currentCredit: "0", originalCredit: "0" } } })
      }
      return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
    })

    const summary = await getBillingOverview(30, {
      canManageFunding: false,
      canManageTeamSubscription: false,
      canReadTeamSubscription: false,
      teamId: "team-1",
      teamName: "acme",
    })

    expect(paths.some((path) => path.startsWith("/api/org/"))).toBe(false)
    expect(paths).not.toContain("/v1/balance/available")
    expect(paths).not.toContain("/api/user/subscriptions")
    expect(summary.balance).toBeNull()
    expect(summary.subscription).toBeNull()
    expect(summary.teamPendingPayment).toBeNull()
    expect(summary.subscriptionAvailable).toBe(true)
    expect(summary.teamPendingPaymentAvailable).toBe(true)
  })

  it("lets admins read team subscription state without accessing creator funding", async () => {
    const paths: string[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      paths.push(url.pathname)
      if (url.pathname === "/api/org/team-1/subscriptions") {
        return Response.json({ data: { features: [], plan: "team_plus", plans: [], platforms: {} }, success: true })
      }
      if (url.pathname === "/api/team/team-1/subscriptions/team/pending_payment") {
        return Response.json({ data: null, success: true })
      }
      return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 0, totalCredit: "0" } } })
    })

    const summary = await getBillingOverview(30, {
      canManageFunding: false,
      canManageTeamSubscription: false,
      canReadTeamSubscription: true,
      teamId: "team-1",
      teamName: "acme",
    })

    expect(paths).toContain("/api/org/team-1/subscriptions")
    expect(paths).toContain("/api/team/team-1/subscriptions/team/pending_payment")
    expect(paths).not.toContain("/v1/balance/available")
    expect(paths).not.toContain("/api/user/subscriptions")
    expect(summary.subscription?.plan).toBe("team_plus")
    expect(summary.balance).toBeNull()
  })

  it("surfaces member session expiry from team usage without reading a personal balance", async () => {
    const paths: string[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      paths.push(url.pathname)
      return new Response("unauthorized", { status: 401 })
    })

    const error = await rejection(() =>
      getBillingOverview(30, {
        canManageFunding: false,
        canManageTeamSubscription: false,
        canReadTeamSubscription: false,
        teamId: "team-1",
        teamName: "acme",
      }),
    )

    expect(error.message).toBe(billingAuthRequiredMessage)
    expect(paths).not.toContain("/v1/balance/available")
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
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-oo-organization-name")).toBeNull()
      return Response.json({
        data: {
          items: [
            { currentCredit: "7.5", originalCredit: "10", serviceScope: "general" },
            { currentCredit: "20", originalCredit: "20", serviceScope: "link" },
          ],
          total: { currentCredit: "27.5", originalCredit: "30" },
        },
      })
    })

    const result = await getCreditBalance({
      canManageFunding: true,
      canManageTeamSubscription: true,
      canReadTeamSubscription: true,
      teamId: "team-1",
      teamName: "acme",
    })

    expect(result).toEqual({ balance: "$7.5", hasCredits: true })
  })

  it("does not expose the signed-in member's personal balance as team funding", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const error = await rejection(() =>
      getCreditBalance({
        canManageFunding: false,
        canManageTeamSubscription: false,
        canReadTeamSubscription: false,
        teamId: "team-1",
        teamName: "acme",
      }),
    )

    expect(error.message).toContain("managed by its creator")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts complete Team plan changes", async () => {
    const request = stubTeamSubscriptionFetch({
      additionalSeats: 0,
      currentPeriodEnd: 0,
      paymentURL: "https://console.example.com/team-checkout",
      plan: "team_plus",
      status: "active",
      subscriptionID: "sub-1",
      targetAdditionalSeats: 0,
      targetPlan: "team_plus",
    })

    const result = await updateTeamSubscription("team-1", { additional_seats: 0, plan: "team_plus" })

    expect(JSON.parse(request.requestBody())).toEqual({ additional_seats: 0, plan: "team_plus" })
    expect(result.paymentURL).toBe("https://console.example.com/team-checkout")
  })

  it("requests a Team plan preview before submission", async () => {
    let body = ""
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      expect(urlOf(input).pathname).toBe("/api/team/team%2Fa%20b/subscriptions/team/preview")
      body = String(init?.body ?? "")
      return Response.json({
        data: {
          amountDue: 3200,
          changeTiming: "immediate",
          currency: "usd",
          mode: "create",
          targetAdditionalSeats: 0,
          targetPlan: "team_plus",
          total: 3200,
        },
        success: true,
      })
    })

    const preview = await previewTeamSubscription("team/a b", { additional_seats: 0, plan: "team_plus" })

    expect(JSON.parse(body)).toEqual({ additional_seats: 0, plan: "team_plus" })
    expect(preview).toEqual({
      amountDue: 3200,
      changeTiming: "immediate",
      currency: "usd",
      mode: "create",
      targetAdditionalSeats: 0,
      targetPlan: "team_plus",
      total: 3200,
    })
  })

  it("posts Team seat changes without plan fields", async () => {
    const request = stubTeamSubscriptionFetch({
      additionalSeats: 1,
      currentPeriodEnd: 0,
      paymentURL: "https://console.example.com/team-seat-checkout",
      plan: null,
      status: "active",
      subscriptionID: "sub-1",
      targetAdditionalSeats: 1,
      targetPlan: null,
    })

    const result = await updateTeamSubscription("team-1", { additional_seats: 1 })

    expect(JSON.parse(request.requestBody())).toEqual({ additional_seats: 1 })
    expect(result.paymentURL).toBe("https://console.example.com/team-seat-checkout")
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

    await getBillingOverview(30, teamScope)

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

    const summary = await getBillingOverview(30, teamScope)

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
      if (url.pathname === "/v2/stats/team/team-1/billing") {
        return Response.json({ data: { items: [], sourceTotals: {}, total: { totalCredit: "2" } } })
      }
      if (url.pathname === "/v2/stats/team/team-1/metering") {
        return Response.json({ data: { items: [], sourceTotals: {}, total: { eventCount: 4 } } })
      }
      return new Promise<Response>(() => undefined)
    })

    const overviewPromise = getBillingOverview(30, teamScope)

    await vi.advanceTimersByTimeAsync(3_000)
    const overview = await overviewPromise

    expect(overview.balance?.total.currentCredit).toBe("8")
    expect(overview.spend?.total.totalCredit).toBe("2")
    expect(overview.metering?.total.eventCount).toBe(4)
    expect(overview.subscription).toBeNull()
    expect(overview.subscriptionAvailable).toBe(false)
    expect(overview.teamPendingPaymentAvailable).toBe(false)
  })

  it("adapts the V2 team stats series (no subject) into the usage DTO", async () => {
    const statsRequests: { path: string; granularity: string | null; hasOrgHeader: boolean }[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.pathname === "/v1/balance/available") {
        return Response.json({ data: { deficit: "0", items: [], total: { currentCredit: "0", originalCredit: "0" } } })
      }
      if (url.hostname === "insight.oomol.com") {
        statsRequests.push({
          path: url.pathname,
          granularity: url.searchParams.get("granularity"),
          hasOrgHeader: new Headers(init?.headers).get("x-oo-organization-name") !== null,
        })
      }
      if (url.pathname === "/v2/stats/team/team-1/billing") {
        return Response.json({
          data: {
            granularity: "daily",
            items: [{ source: "SERVICE_LLM", time: 1_700_000_000_000, totalCredit: "1.5" }],
            sourceTotals: { SERVICE_LLM: { totalCredit: "1.5" } },
            total: { totalCredit: "1.5" },
          },
        })
      }
      if (url.pathname === "/v2/stats/team/team-1/metering") {
        return Response.json({
          data: {
            granularity: "daily",
            items: [{ source: "SERVICE_OOMOL_CONNECTOR", time: 1_700_000_000_000, eventCount: 7 }],
            sourceTotals: { SERVICE_OOMOL_CONNECTOR: { eventCount: 7 } },
            total: { eventCount: 7 },
          },
        })
      }
      return new Promise<Response>(() => undefined)
    })

    const overview = await getBillingOverview(30, teamScope)

    // V2 series drops per-bucket subject; the adapter fills subject:"" and preserves time/source/values.
    expect(overview.spend?.items).toEqual([
      {
        source: "SERVICE_LLM",
        subject: "",
        time: 1_700_000_000_000,
        totalCredit: "1.5",
        totalUsage: undefined,
        eventCount: undefined,
      },
    ])
    expect(overview.spend?.total.totalCredit).toBe("1.5")
    expect(overview.metering?.items).toEqual([
      {
        source: "SERVICE_OOMOL_CONNECTOR",
        subject: "",
        time: 1_700_000_000_000,
        totalCredit: undefined,
        totalUsage: undefined,
        eventCount: 7,
      },
    ])
    expect(overview.metering?.total.eventCount).toBe(7)

    // Both team stats calls hit the path-scoped V2 route with daily granularity and no org-name header.
    expect(statsRequests.map((request) => request.path).sort()).toEqual([
      "/v2/stats/team/team-1/billing",
      "/v2/stats/team/team-1/metering",
    ])
    expect(statsRequests.every((request) => request.granularity === "daily")).toBe(true)
    expect(statsRequests.some((request) => request.hasOrgHeader)).toBe(false)
  })

  it("clamps an over-limit usage window to the V2 team route's 30-day daily cap", async () => {
    // Regression guard: the V2 team route (/v2/stats/team/:teamId/*) rejects daily windows wider than
    // 30 days with HTTP 400. getBillingOverview takes a raw number, so a caller passing 90 (outside the
    // BillingPeriodDays union) must still be clamped to a 30-day span rather than sending an invalid query.
    const windows: number[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.hostname === "insight.oomol.com" && url.pathname.startsWith("/v2/stats/team/")) {
        const startTime = Number(url.searchParams.get("startTime"))
        const endTime = Number(url.searchParams.get("endTime"))
        windows.push((endTime - startTime) / (24 * 60 * 60 * 1000))
      }
      if (url.pathname === "/v1/balance/available") {
        return Response.json({ data: { deficit: "0", items: [], total: { currentCredit: "0", originalCredit: "0" } } })
      }
      return Response.json({ data: { items: [], sourceTotals: {}, total: { totalCredit: "0", eventCount: 0 } } })
    })

    await getBillingOverview(90, teamScope)

    expect(windows).toHaveLength(2)
    expect(windows.every((days) => days === 30)).toBe(true)
  })

  it("rejects parent cancellation even after a core billing request succeeds", async () => {
    const controller = new AbortController()
    const cancellation = new Error("Billing view was closed.")
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.pathname === "/v1/balance/available") {
        return Response.json({
          data: {
            items: [{ currentCredit: "8", originalCredit: "10" }],
            total: { currentCredit: "8", originalCredit: "10" },
          },
        })
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        const abort = () => reject(signal?.reason)
        if (signal?.aborted) {
          abort()
        } else {
          signal?.addEventListener("abort", abort, { once: true })
        }
      })
    })

    const overview = getBillingOverview(30, teamScope, controller.signal)
    await Promise.resolve()
    controller.abort(cancellation)

    await expect(overview).rejects.toBe(cancellation)
  })
})
