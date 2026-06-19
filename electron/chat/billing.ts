import type {
  BillingLogItem,
  BillingOverviewRequest,
  BillingOverviewResult,
  BillingSpendStats,
  BillingSummaryResult,
  CreditBalanceResult,
  CreditItem,
  CreditUsages,
  OpenBillingPageRequest,
  OpenSubscriptionCheckoutRequest,
  OpenTopUpCheckoutRequest,
  SubscriptionSchedule,
  SubscriptionStatus,
} from "./common.ts"

import { consoleBaseUrl, consoleServerBaseUrl, insightBaseUrl } from "../domain.ts"

const billingPath = "/billing"
const dayMs = 24 * 60 * 60 * 1000
const billingRequestTimeoutMs = 12_000
const billingLogsMaxRangeDays = 30
const billingLogsMaxPagesPerRange = 100
const billingSummaryCacheMs = 30_000
const billingOverviewCacheMs = 60_000

interface BillingCacheEntry<T> {
  accountKey: string
  data: T
  fetchedAt: number
}

interface BillingInFlight<T> {
  accountKey: string
  promise: Promise<T>
}

export interface BillingLogRange {
  endTime: number
  startTime: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatCredits(value: unknown): string | null {
  const amount = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN
  if (!Number.isFinite(amount)) {
    return null
  }
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount)}`
}

function sumCreditValues(values: unknown[]): number {
  return values.reduce<number>((sum, value) => {
    const amount = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN
    return Number.isFinite(amount) ? sum + amount : sum
  }, 0)
}

function isGeneralCreditItem(item: unknown): boolean {
  if (!item || typeof item !== "object") {
    return true
  }
  const scope = "serviceScope" in item && typeof item.serviceScope === "string" ? item.serviceScope : ""
  const normalized = scope
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  if (!normalized) {
    return true
  }
  if (new Set(["all", "common", "default", "general", "global", "universal", "通用"]).has(normalized)) {
    return true
  }
  return !/auth|authorization|authorisation|link|cloud|授权|链接|云任务/.test(normalized)
}

function filterGeneralCreditUsages(usages: CreditUsages): CreditUsages {
  const items = usages.items.filter(isGeneralCreditItem)
  return {
    ...usages,
    items,
    total: {
      originalCredit: String(sumCreditValues(items.map((item) => item.originalCredit))),
      currentCredit: String(sumCreditValues(items.map((item) => item.currentCredit))),
    },
  }
}

function readCreditBalance(payload: unknown): CreditBalanceResult {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const items = Array.isArray(record["items"]) ? record["items"].filter(isGeneralCreditItem) : []
  const total =
    record["total"] && typeof record["total"] === "object" ? (record["total"] as Record<string, unknown>) : {}
  const rawCurrent =
    items.length > 0
      ? sumCreditValues(
          items.map((item) =>
            item && typeof item === "object" ? (item as Record<string, unknown>)["currentCredit"] : undefined,
          ),
        )
      : total["currentCredit"]
  const amount = typeof rawCurrent === "number" ? rawCurrent : Number(rawCurrent)
  return {
    balance: formatCredits(rawCurrent),
    hasCredits: Number.isFinite(amount) && amount > 0,
  }
}

function readCreditUsages(payload: unknown): CreditUsages {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const total =
    record["total"] && typeof record["total"] === "object" ? (record["total"] as Record<string, unknown>) : {}
  return {
    items: Array.isArray(record["items"])
      ? (record["items"].filter((item): item is CreditItem =>
          Boolean(item && typeof item === "object"),
        ) as CreditItem[])
      : [],
    ...(typeof record["nextToken"] === "string" ? { nextToken: record["nextToken"] } : {}),
    total: {
      originalCredit: String(total["originalCredit"] ?? "0"),
      currentCredit: String(total["currentCredit"] ?? "0"),
    },
    deficit: String(record["deficit"] ?? "0"),
  }
}

export function readBillingLogs(payload: unknown): BillingLogItem[] {
  const source = unwrapApiData<unknown>(payload)
  if (Array.isArray(source)) {
    return source.filter(isBillingLogItem)
  }
  if (!source || typeof source !== "object") {
    return []
  }
  const record = source as Record<string, unknown>
  const items = [record["items"], record["logs"], record["records"]].find(Array.isArray)
  return Array.isArray(items) ? items.filter(isBillingLogItem) : []
}

function isBillingLogItem(item: unknown): item is BillingLogItem {
  return Boolean(item && typeof item === "object")
}

export function ensureHttpUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened.")
  }
  return url.toString()
}

function billingUrl(target: OpenBillingPageRequest["target"]): string {
  const url = new URL(billingPath, consoleBaseUrl)
  if (target === "usage") {
    url.searchParams.set("tab", "usage")
  }
  return ensureHttpUrl(url.toString())
}

function authRequest(token: string): RequestInit {
  return {
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Cookie: `oomol-token=${token}`,
    },
  }
}

function checkoutReturnUrl(): string {
  const target = new URL(consoleBaseUrl)
  if (target.hostname.startsWith("console.")) {
    target.hostname = `chat.${target.hostname.slice("console.".length)}`
  }
  target.pathname = billingPath
  target.search = ""
  target.hash = ""
  return ensureHttpUrl(target.toString())
}

function statsRange(days: number): { endTime: number; startTime: number } {
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
  const endTime = Date.now()
  return { endTime, startTime: endTime - normalizedDays * dayMs }
}

export function billingLogRanges(days: number, endTime = Date.now()): BillingLogRange[] {
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
  const ranges: BillingLogRange[] = []
  let remainingDays = normalizedDays
  let rangeEndTime = endTime
  while (remainingDays > 0) {
    const rangeDays = Math.min(remainingDays, billingLogsMaxRangeDays)
    const startTime = rangeEndTime - rangeDays * dayMs
    ranges.push({ endTime: rangeEndTime, startTime })
    rangeEndTime = startTime
    remainingDays -= rangeDays
  }
  return ranges
}

function unwrapConsoleData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    const wrapped = payload as { data: T; message?: unknown; success: unknown }
    if (wrapped.success === false) {
      throw new Error(typeof wrapped.message === "string" ? wrapped.message : "Request failed.")
    }
    return wrapped.data
  }
  return payload as T
}

function unwrapApiData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

function logSettledFailure(label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === "rejected") {
    console.warn("[lumo] billing overview request failed", { label, error: errorMessage(result.reason) })
  }
}

function createEmptyBillingOverviewResult(): BillingOverviewResult {
  return { balance: null, spend: null, metering: null, logs: [], subscription: null, schedules: [] }
}

export class BillingClient {
  private authToken: string | undefined
  private userId: string | undefined
  private readonly billingCache = new Map<string, BillingCacheEntry<BillingOverviewResult>>()
  private readonly billingInFlight = new Map<string, BillingInFlight<BillingOverviewResult>>()

  public setToken(token: string | undefined): void {
    this.setAccountContext({ token })
  }

  public setAccountContext(context: { token?: string; userId?: string }): void {
    const previousAccountKey = this.billingAccountKey()
    this.authToken = context.token
    this.userId = context.userId
    if (this.billingAccountKey() !== previousAccountKey) {
      this.clearBillingCache()
    }
  }

  public billingPageUrl(req: OpenBillingPageRequest): string {
    return billingUrl(req.target)
  }

  public async topUpCheckoutUrl(req: OpenTopUpCheckoutRequest): Promise<string> {
    if (!this.authToken) {
      return this.billingPageUrl({ target: "recharge" })
    }
    const url = new URL("/api/user/web_top_up_url", consoleServerBaseUrl)
    url.searchParams.set("price", req.price)
    url.searchParams.set("redirect", checkoutReturnUrl())
    const checkoutUrl = unwrapConsoleData<string>(await this.fetchConsoleJson(url))
    if (!checkoutUrl) {
      throw new Error("Top-up URL response is invalid.")
    }
    return ensureHttpUrl(checkoutUrl)
  }

  public async subscriptionCheckoutUrl(req: OpenSubscriptionCheckoutRequest): Promise<string> {
    if (!this.authToken) {
      return this.billingPageUrl({ target: "recharge" })
    }
    const url = new URL("/api/user/subscriptions/page", consoleServerBaseUrl)
    url.searchParams.set("payment_type", "subscription")
    url.searchParams.set("redirect", checkoutReturnUrl())
    url.searchParams.set("source_page", checkoutReturnUrl())
    url.searchParams.set("client_platform", "chat-web")
    url.searchParams.set("plan", req.plan)
    if (this.userId) {
      url.searchParams.set("user_id", this.userId)
    }
    return ensureHttpUrl(url.toString())
  }

  public async subscriptionPortalUrl(): Promise<string> {
    if (!this.authToken) {
      return this.billingPageUrl({ target: "recharge" })
    }
    const url = new URL("/api/stripe/portal", consoleServerBaseUrl)
    url.searchParams.set("product", "ai")
    const portalUrl = unwrapConsoleData<string>(await this.fetchConsoleJson(url))
    if (!portalUrl) {
      throw new Error("Subscription portal URL response is invalid.")
    }
    return ensureHttpUrl(portalUrl)
  }

  public async getBillingSummary(req: BillingOverviewRequest): Promise<BillingSummaryResult> {
    if (!this.authToken) {
      return createEmptyBillingOverviewResult()
    }
    return this.getCachedBillingResult(`summary:${req.days}`, billingSummaryCacheMs, Boolean(req.forceRefresh), () =>
      this.fetchBillingSummary(req.days),
    )
  }

  public async getBillingOverview(req: BillingOverviewRequest): Promise<BillingOverviewResult> {
    if (!this.authToken) {
      return createEmptyBillingOverviewResult()
    }
    return this.getCachedBillingResult(`overview:${req.days}`, billingOverviewCacheMs, Boolean(req.forceRefresh), () =>
      this.fetchBillingOverview(req.days),
    )
  }

  public async getCreditBalance(): Promise<CreditBalanceResult> {
    if (!this.authToken) {
      return { balance: null, hasCredits: false }
    }
    const response = await fetch(new URL("/v1/balance/available", insightBaseUrl), authRequest(this.authToken))
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Failed to get credit balance: ${response.status}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = undefined
    }
    return readCreditBalance(payload)
  }

  private async fetchBillingSummary(days: number): Promise<BillingSummaryResult> {
    const [balance, spend, metering] = await Promise.allSettled([
      this.getAllCreditUsages(),
      this.getCreditSpendStats(days),
      this.getCreditMeteringStats(days),
    ])
    logSettledFailure("balance", balance)
    logSettledFailure("spend", spend)
    logSettledFailure("metering", metering)
    const criticalResults = [balance, spend, metering]
    const allCriticalFailed = criticalResults.every((result) => result.status === "rejected")
    if (allCriticalFailed && balance.status === "rejected") {
      throw balance.reason
    }
    return {
      balance: balance.status === "fulfilled" ? filterGeneralCreditUsages(balance.value) : null,
      spend: spend.status === "fulfilled" ? spend.value : null,
      metering: metering.status === "fulfilled" ? metering.value : null,
      logs: [],
      subscription: null,
      schedules: [],
    }
  }

  private async fetchBillingOverview(days: number): Promise<BillingOverviewResult> {
    const [balance, spend, metering, logs, subscription, schedules] = await Promise.allSettled([
      this.getAllCreditUsages(),
      this.getCreditSpendStats(days),
      this.getCreditMeteringStats(days),
      this.getBillingLogs(days),
      this.getSubscriptionStatus(),
      this.getSubscriptionSchedules(),
    ])
    logSettledFailure("balance", balance)
    logSettledFailure("spend", spend)
    logSettledFailure("metering", metering)
    logSettledFailure("logs", logs)
    logSettledFailure("subscription", subscription)
    logSettledFailure("schedules", schedules)
    const criticalResults = [balance, spend, metering]
    const allCriticalFailed = criticalResults.every((result) => result.status === "rejected")
    if (allCriticalFailed && balance.status === "rejected") {
      throw balance.reason
    }
    return {
      balance: balance.status === "fulfilled" ? filterGeneralCreditUsages(balance.value) : null,
      spend: spend.status === "fulfilled" ? spend.value : null,
      metering: metering.status === "fulfilled" ? metering.value : null,
      logs: logs.status === "fulfilled" ? logs.value : [],
      subscription: subscription.status === "fulfilled" ? subscription.value : null,
      schedules: schedules.status === "fulfilled" ? schedules.value : [],
    }
  }

  private async getCachedBillingResult(
    key: string,
    ttlMs: number,
    forceRefresh: boolean,
    load: () => Promise<BillingOverviewResult>,
  ): Promise<BillingOverviewResult> {
    const accountKey = this.billingAccountKey()
    if (!accountKey) {
      return createEmptyBillingOverviewResult()
    }

    const cached = this.billingCache.get(key)
    const now = Date.now()
    if (!forceRefresh && cached?.accountKey === accountKey && now - cached.fetchedAt < ttlMs) {
      return cached.data
    }

    const inFlight = this.billingInFlight.get(key)
    if (!forceRefresh && inFlight?.accountKey === accountKey) {
      return inFlight.promise
    }

    const request = load()
      .then((data) => {
        if (this.billingAccountKey() === accountKey) {
          this.billingCache.set(key, { accountKey, data, fetchedAt: Date.now() })
        }
        return data
      })
      .catch((error: unknown) => {
        if (cached?.accountKey === accountKey) {
          console.warn("[lumo] using stale billing cache after refresh failed", { key, error: errorMessage(error) })
          return cached.data
        }
        throw error
      })
      .finally(() => {
        if (this.billingInFlight.get(key)?.promise === request) {
          this.billingInFlight.delete(key)
        }
      })

    this.billingInFlight.set(key, { accountKey, promise: request })
    return request
  }

  private billingAccountKey(): string | undefined {
    return this.userId ?? this.authToken
  }

  private clearBillingCache(): void {
    this.billingCache.clear()
    this.billingInFlight.clear()
  }

  private async fetchConsoleJson(url: URL): Promise<unknown> {
    if (!this.authToken) {
      throw new Error("Sign in is required.")
    }
    const response = await fetch(url, {
      ...authRequest(this.authToken),
      signal: AbortSignal.timeout(billingRequestTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(text || `Request failed with status ${response.status}`)
    }
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  private async fetchInsightJson(url: URL): Promise<unknown> {
    if (!this.authToken) {
      throw new Error("Sign in is required.")
    }
    const response = await fetch(url, {
      ...authRequest(this.authToken),
      signal: AbortSignal.timeout(billingRequestTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(text || `Request failed with status ${response.status}`)
    }
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  private async getAllCreditUsages(): Promise<CreditUsages> {
    const firstPage = await this.getCreditUsages()
    const items = [...firstPage.items]
    let nextToken = firstPage.nextToken
    while (nextToken) {
      const nextPage = await this.getCreditUsages(nextToken)
      items.push(...nextPage.items)
      nextToken = nextPage.nextToken
    }
    return { ...firstPage, items, nextToken: undefined }
  }

  private async getCreditUsages(nextToken?: string): Promise<CreditUsages> {
    const url = new URL("/v1/balance/available", insightBaseUrl)
    if (nextToken) {
      url.searchParams.set("nextToken", nextToken)
    }
    return readCreditUsages(unwrapApiData<unknown>(await this.fetchInsightJson(url)))
  }

  private async getCreditSpendStats(days: number): Promise<BillingSpendStats> {
    const { endTime, startTime } = statsRange(days)
    const url = new URL("/v1/stats/billing", insightBaseUrl)
    url.searchParams.set("granularity", "daily")
    url.searchParams.set("startTime", String(startTime))
    url.searchParams.set("endTime", String(endTime))
    return unwrapApiData<BillingSpendStats>(await this.fetchInsightJson(url))
  }

  private async getCreditMeteringStats(days: number): Promise<BillingSpendStats> {
    const { endTime, startTime } = statsRange(days)
    const url = new URL("/v1/stats/metering", insightBaseUrl)
    url.searchParams.set("granularity", "daily")
    url.searchParams.set("startTime", String(startTime))
    url.searchParams.set("endTime", String(endTime))
    return unwrapApiData<BillingSpendStats>(await this.fetchInsightJson(url))
  }

  private async getBillingLogs(days: number): Promise<BillingLogItem[]> {
    const ranges = billingLogRanges(days)
    const pages = await Promise.all(ranges.map((range) => this.getAllBillingLogsInRange(range)))
    return pages.flat().sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
  }

  private async getAllBillingLogsInRange(range: BillingLogRange): Promise<BillingLogItem[]> {
    const items: BillingLogItem[] = []
    for (let page = 1; page <= billingLogsMaxPagesPerRange; page += 1) {
      const pageItems = await this.getBillingLogsPage(range, page)
      if (pageItems.length === 0) {
        break
      }
      items.push(...pageItems)
    }
    return items
  }

  private async getBillingLogsPage({ endTime, startTime }: BillingLogRange, page: number): Promise<BillingLogItem[]> {
    const url = new URL("/v1/logs/billing", insightBaseUrl)
    url.searchParams.set("from", String(startTime))
    url.searchParams.set("to", String(endTime))
    url.searchParams.set("page", String(page))
    return readBillingLogs(await this.fetchInsightJson(url))
  }

  private async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    const url = new URL("/api/user/subscriptions", consoleServerBaseUrl)
    return unwrapConsoleData<SubscriptionStatus>(await this.fetchConsoleJson(url))
  }

  private async getSubscriptionSchedules(): Promise<SubscriptionSchedule[]> {
    const url = new URL("/api/user/subscriptions/schedulers", consoleServerBaseUrl)
    return unwrapConsoleData<SubscriptionSchedule[]>(await this.fetchConsoleJson(url))
  }
}
