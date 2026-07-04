import type {
  BillingLogItem,
  BillingOverviewResult,
  BillingPageTarget,
  BillingSpendStats,
  BillingSummaryResult,
  CreditBalanceResult,
  CreditItem,
  CreditUsages,
  RechargePrice,
  SubscriptionPlanTag,
  SubscriptionSchedule,
  SubscriptionStatus,
  WantaSubscriptionChangePayload,
  WantaSubscriptionUpdateResult,
  WantaPendingPaymentResult,
  WantaSubscriptionPlan,
} from "../../electron/chat/common.ts"

import { consoleBaseUrl, consoleServerBaseUrl, insightBaseUrl } from "@/lib/domain"
import { authRequiredMessage, oomolFetchJson } from "@/lib/oomol-http"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

// 额度中心的全部网络读取与结账 URL 解析在渲染层直接发起：原先这些是渲染业务驱动、却由主进程
// BillingClient 代发的请求。凭证经 httpOnly 会话 cookie 自动附带（oomolFetchJson 内 credentials:"include"），
// token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。本模块刻意无状态——缓存/去重交给
// useBillingOverview（避免双层缓存）。

const billingPath = "/billing"
const dayMs = 24 * 60 * 60 * 1000
const billingRequestTimeoutMs = 12_000
const billingOptionalRequestSoftTimeoutMs = 3_000
const billingLogsMaxRangeDays = 30
const billingLogsMaxPagesPerRange = 100
const billingCreditUsagesMaxPages = 100
export const wantaSubscriptionPlans: readonly WantaSubscriptionPlan[] = ["wanta_plus", "wanta_pro"]

/** 会话过期/缺失的哨兵文案（与 oomol-http 的 authRequiredMessage 同字面量）；resolveUserFacingError 据此归为 auth_required。 */
export const billingAuthRequiredMessage = authRequiredMessage

export interface BillingLogRange {
  endTime: number
  startTime: number
}

function isBillingAuthRequiredReason(reason: unknown): boolean {
  return reason instanceof Error && reason.message === billingAuthRequiredMessage
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

function readWantaPendingPayment(payload: unknown): WantaPendingPaymentResult | null {
  const source = unwrapConsoleData<unknown>(payload)
  if (!source || typeof source !== "object") {
    return null
  }
  const record = source as Record<string, unknown>
  return {
    subscriptionID: readStringField(record, ["subscriptionID", "subscriptionId", "subscription_id"]),
    status: readStringField(record, ["status"]),
    plan: isWantaSubscriptionPlan(record["plan"]) ? record["plan"] : null,
    additionalSeats: readIntegerField(record, ["additionalSeats", "additional_seats"]),
    currentPeriodEnd: readOptionalTimestampField(record, ["currentPeriodEnd", "current_period_end"]),
    latestInvoiceID: readStringField(record, ["latestInvoiceID", "latestInvoiceId", "latest_invoice_id"]),
    paymentRequired: readBooleanField(record, ["paymentRequired", "payment_required"]),
    paymentURL: readStringField(record, ["paymentURL", "paymentUrl", "payment_url"]),
    invoiceStatus: readStringField(record, ["invoiceStatus", "invoice_status"]),
    amountRemaining: readOptionalNumberField(record, ["amountRemaining", "amount_remaining"]),
    currency: readStringField(record, ["currency"]),
    pendingUpdate: readBooleanField(record, ["pendingUpdate", "pending_update"]),
    pendingUpdateExpiresAt: readOptionalTimestampField(record, ["pendingUpdateExpiresAt", "pending_update_expires_at"]),
  }
}

function readWantaSubscriptionUpdate(payload: unknown): WantaSubscriptionUpdateResult {
  const source = unwrapConsoleData<unknown>(payload)
  if (!source || typeof source !== "object") {
    throw new Error("Wanta subscription response is invalid.")
  }
  const record = source as Record<string, unknown>
  return {
    subscriptionID: readStringField(record, ["subscriptionID", "subscriptionId", "subscription_id"]) ?? "",
    status: readStringField(record, ["status"]) ?? "",
    plan: readPlanField(record, ["plan"]),
    additionalSeats: readIntegerField(record, ["additionalSeats", "additional_seats"]),
    targetPlan: readPlanField(record, ["targetPlan", "target_plan"]),
    targetAdditionalSeats: readIntegerField(record, ["targetAdditionalSeats", "target_additional_seats"]),
    currentPeriodEnd: readTimestampField(record, ["currentPeriodEnd", "current_period_end"]) ?? 0,
    latestInvoiceID: readStringField(record, ["latestInvoiceID", "latestInvoiceId", "latest_invoice_id"]),
    paymentRequired: readBooleanField(record, ["paymentRequired", "payment_required"]),
    paymentURL: readStringField(record, ["paymentURL", "paymentUrl", "payment_url"]),
    invoiceStatus: readStringField(record, ["invoiceStatus", "invoice_status"]),
    amountRemaining: readOptionalNumberField(record, ["amountRemaining", "amount_remaining"]),
    currency: readStringField(record, ["currency"]),
    pendingUpdate: readBooleanField(record, ["pendingUpdate", "pending_update"]),
    pendingUpdateExpiresAt: readOptionalTimestampField(record, ["pendingUpdateExpiresAt", "pending_update_expires_at"]),
    scheduledUpdate: readBooleanField(record, ["scheduledUpdate", "scheduled_update"]),
    scheduledEffectiveAt: readOptionalTimestampField(record, ["scheduledEffectiveAt", "scheduled_effective_at"]),
  }
}

function readPlanField(record: Record<string, unknown>, keys: string[]): WantaSubscriptionPlan | null {
  for (const key of keys) {
    const value = record[key]
    if (isWantaSubscriptionPlan(value)) {
      return value
    }
  }
  return null
}

function isWantaSubscriptionPlan(value: unknown): value is WantaSubscriptionPlan {
  return typeof value === "string" && wantaSubscriptionPlans.includes(value as WantaSubscriptionPlan)
}

export function readBillingLogs(payload: unknown): BillingLogItem[] {
  const source = unwrapApiData<unknown>(payload)
  const items = findBillingLogArray(source)
  return items.flatMap((item) => {
    const log = normalizeBillingLogItem(item)
    return log ? [log] : []
  })
}

function findBillingLogArray(source: unknown): unknown[] {
  if (Array.isArray(source)) {
    return source
  }
  if (!source || typeof source !== "object") {
    return []
  }
  const record = source as Record<string, unknown>
  const directItems = [
    record["items"],
    record["logs"],
    record["records"],
    record["list"],
    record["rows"],
    record["results"],
  ].find(Array.isArray)
  if (Array.isArray(directItems)) {
    return directItems
  }
  const nestedSource = [record["data"], record["result"], record["payload"]].find(
    (value) => value && typeof value === "object",
  )
  return nestedSource && nestedSource !== source ? findBillingLogArray(nestedSource) : []
}

function normalizeBillingLogItem(item: unknown): BillingLogItem | null {
  if (!item || typeof item !== "object") {
    return null
  }
  const record = item as Record<string, unknown>
  const createdAt = readTimestampField(record, ["createdAt", "created_at", "time", "timestamp", "eventTime", "date"])
  if (createdAt === null) {
    return null
  }
  const source = readStringField(record, ["source", "service", "serviceName", "sourceName"]) ?? ""
  const subject = readStringField(record, ["subject", "model", "action", "name", "description"]) ?? ""
  const sourceType = readStringField(record, ["sourceType", "source_type", "type", "category"]) ?? ""
  const traceID = readStringField(record, ["traceID", "traceId", "trace_id", "requestID", "requestId"]) ?? ""
  return {
    createdAt,
    debitCredit: readNumberStringField(record, [
      "debitCredit",
      "debit_credit",
      "totalCredit",
      "total_credit",
      "credit",
      "amount",
      "cost",
      "usage",
    ]),
    eventID: readStringField(record, ["eventID", "eventId", "event_id", "id"]) ?? "",
    payload:
      record["payload"] && typeof record["payload"] === "object" ? (record["payload"] as Record<string, unknown>) : {},
    serviceScope: readStringField(record, ["serviceScope", "service_scope", "scope"]) ?? "",
    source,
    sourceType,
    subject,
    traceID,
    userID: readStringField(record, ["userID", "userId", "user_id"]) ?? "",
  }
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

function readNumberStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    const amount = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN
    if (Number.isFinite(amount)) {
      return String(amount)
    }
  }
  return "0"
}

function readTimestampField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value > 0 && value < 10_000_000_000 ? value * 1000 : value
    }
    if (typeof value !== "string" || !value.trim()) {
      continue
    }
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function readOptionalTimestampField(record: Record<string, unknown>, keys: string[]): number | null {
  return readTimestampField(record, keys)
}

function readIntegerField(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    const amount = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN
    if (Number.isFinite(amount)) {
      return Math.max(0, Math.floor(amount))
    }
  }
  return 0
}

function readOptionalNumberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    const amount = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN
    if (Number.isFinite(amount)) {
      return amount
    }
  }
  return null
}

function readBooleanField(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "boolean") {
      return value
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase()
      if (normalized === "true") {
        return true
      }
      if (normalized === "false") {
        return false
      }
    }
  }
  return false
}

export function ensureHttpUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened.")
  }
  return url.toString()
}

function billingUrl(target: BillingPageTarget): string {
  const url = new URL(billingPath, consoleBaseUrl)
  if (target === "usage") {
    url.searchParams.set("tab", "usage")
  }
  return ensureHttpUrl(url.toString())
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
    console.warn("[wanta] billing overview request failed", { label, error: errorMessage(result.reason) })
    reportRendererHandledError("billingClient.request", `Billing overview request failed: ${label}`, result.reason)
  }
}

function preventEarlyUnhandledRejection(promise: Promise<unknown>): void {
  void promise.catch(() => {
    // 调用方稍后会通过 allSettled/settleWithSoftTimeout 统一记录和降级。
  })
}

function settleWithSoftTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = billingOptionalRequestSoftTimeoutMs,
): Promise<PromiseSettledResult<T>> {
  return new Promise((resolve) => {
    let completed = false
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true
        resolve({ status: "rejected", reason: new Error(`${label} request timed out.`) })
      }
    }, timeoutMs)

    void promise.then(
      (value) => {
        if (!completed) {
          completed = true
          clearTimeout(timer)
          resolve({ status: "fulfilled", value })
        }
      },
      (reason: unknown) => {
        if (!completed) {
          completed = true
          clearTimeout(timer)
          resolve({ status: "rejected", reason })
        }
      },
    )
  })
}

function billingLogKey(item: BillingLogItem): string {
  return item.eventID || item.traceID || `${item.source}:${item.subject}:${item.createdAt}:${item.debitCredit}`
}

function fetchAuthenticatedJson(url: URL): Promise<unknown> {
  return oomolFetchJson<unknown>(url, { timeoutMs: billingRequestTimeoutMs })
}

export async function getCreditBalance(): Promise<CreditBalanceResult> {
  const url = new URL("/v1/balance/available", insightBaseUrl)
  return readCreditBalance(await fetchAuthenticatedJson(url))
}

async function getCreditUsages(nextToken?: string): Promise<CreditUsages> {
  const url = new URL("/v1/balance/available", insightBaseUrl)
  if (nextToken) {
    url.searchParams.set("nextToken", nextToken)
  }
  return readCreditUsages(unwrapApiData<unknown>(await fetchAuthenticatedJson(url)))
}

async function getAllCreditUsages(): Promise<CreditUsages> {
  const firstPage = await getCreditUsages()
  const items = [...firstPage.items]
  let nextToken = firstPage.nextToken
  let pageCount = 1
  const seenTokens = new Set<string>()
  while (nextToken && pageCount < billingCreditUsagesMaxPages) {
    if (seenTokens.has(nextToken)) {
      console.warn("[wanta] stopped billing balance pagination after repeated token")
      break
    }
    seenTokens.add(nextToken)
    const nextPage = await getCreditUsages(nextToken)
    if (nextPage.items.length === 0) {
      break
    }
    items.push(...nextPage.items)
    nextToken = nextPage.nextToken
    pageCount += 1
  }
  return { ...firstPage, items, nextToken: undefined }
}

async function getCreditSpendStats(days: number): Promise<BillingSpendStats> {
  const { endTime, startTime } = statsRange(days)
  const url = new URL("/v1/stats/billing", insightBaseUrl)
  url.searchParams.set("granularity", "daily")
  url.searchParams.set("startTime", String(startTime))
  url.searchParams.set("endTime", String(endTime))
  return unwrapApiData<BillingSpendStats>(await fetchAuthenticatedJson(url))
}

async function getCreditMeteringStats(days: number): Promise<BillingSpendStats> {
  const { endTime, startTime } = statsRange(days)
  const url = new URL("/v1/stats/metering", insightBaseUrl)
  url.searchParams.set("granularity", "daily")
  url.searchParams.set("startTime", String(startTime))
  url.searchParams.set("endTime", String(endTime))
  return unwrapApiData<BillingSpendStats>(await fetchAuthenticatedJson(url))
}

async function getBillingLogsPage({ endTime, startTime }: BillingLogRange, page: number): Promise<BillingLogItem[]> {
  const url = new URL("/v1/logs/billing", insightBaseUrl)
  url.searchParams.set("from", String(startTime))
  url.searchParams.set("to", String(endTime))
  url.searchParams.set("page", String(page))
  return readBillingLogs(await fetchAuthenticatedJson(url))
}

async function getAllBillingLogsInRange(range: BillingLogRange): Promise<BillingLogItem[]> {
  const items: BillingLogItem[] = []
  const seenKeys = new Set<string>()
  for (let page = 1; page <= billingLogsMaxPagesPerRange; page += 1) {
    const pageItems = await getBillingLogsPage(range, page)
    if (pageItems.length === 0) {
      break
    }
    const freshItems = pageItems.filter((item) => {
      const key = billingLogKey(item)
      if (seenKeys.has(key)) {
        return false
      }
      seenKeys.add(key)
      return true
    })
    if (freshItems.length === 0) {
      console.warn("[wanta] stopped billing log pagination after repeated page", { page })
      break
    }
    items.push(...freshItems)
  }
  return items
}

async function getBillingLogs(days: number): Promise<BillingLogItem[]> {
  const ranges = billingLogRanges(days)
  const pages = await Promise.all(ranges.map((range) => getAllBillingLogsInRange(range)))
  return pages.flat().sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
}

async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const url = new URL("/api/user/subscriptions", consoleServerBaseUrl)
  return unwrapConsoleData<SubscriptionStatus>(await fetchAuthenticatedJson(url))
}

async function getSubscriptionSchedules(): Promise<SubscriptionSchedule[]> {
  const url = new URL("/api/user/subscriptions/schedulers", consoleServerBaseUrl)
  return unwrapConsoleData<SubscriptionSchedule[]>(await fetchAuthenticatedJson(url))
}

async function getWantaPendingPayment(): Promise<WantaPendingPaymentResult | null> {
  const url = new URL("/api/user/subscriptions/wanta/pending_payment", consoleServerBaseUrl)
  return readWantaPendingPayment(await fetchAuthenticatedJson(url))
}

export async function getBillingSummary(days: number): Promise<BillingSummaryResult> {
  const subscriptionPromise = getSubscriptionStatus()
  preventEarlyUnhandledRejection(subscriptionPromise)
  const [balance, spend, metering] = await Promise.allSettled([
    getAllCreditUsages(),
    getCreditSpendStats(days),
    getCreditMeteringStats(days),
  ])
  const subscription = await settleWithSoftTimeout("subscription", subscriptionPromise)
  logSettledFailure("balance", balance)
  logSettledFailure("spend", spend)
  logSettledFailure("metering", metering)
  logSettledFailure("subscription", subscription)
  // 会话过期优先于一切：余额鉴权失败必须上抛 auth_required，否则会被 UI 渲染成假 "$0"。
  if (balance.status === "rejected" && isBillingAuthRequiredReason(balance.reason)) {
    throw balance.reason
  }
  const criticalResults = [balance, spend, metering]
  if (criticalResults.every((result) => result.status === "rejected") && balance.status === "rejected") {
    throw balance.reason
  }
  return {
    balance: balance.status === "fulfilled" ? filterGeneralCreditUsages(balance.value) : null,
    spend: spend.status === "fulfilled" ? spend.value : null,
    metering: metering.status === "fulfilled" ? metering.value : null,
    logs: [],
    subscription: subscription.status === "fulfilled" ? subscription.value : null,
    schedules: [],
    // summary 路径刻意不拉待支付状态，避免轻量刷新额外请求订阅结账接口。
    wantaPendingPayment: null,
  }
}

export async function getBillingOverview(days: number): Promise<BillingOverviewResult> {
  const balancePromise = getAllCreditUsages()
  const spendPromise = getCreditSpendStats(days)
  const meteringPromise = getCreditMeteringStats(days)
  const logsPromise = getBillingLogs(days)
  const subscriptionPromise = getSubscriptionStatus()
  const schedulesPromise = getSubscriptionSchedules()
  const wantaPendingPaymentPromise = getWantaPendingPayment()

  preventEarlyUnhandledRejection(logsPromise)
  preventEarlyUnhandledRejection(subscriptionPromise)
  preventEarlyUnhandledRejection(schedulesPromise)
  preventEarlyUnhandledRejection(wantaPendingPaymentPromise)

  const [balance, spend, metering] = await Promise.allSettled([balancePromise, spendPromise, meteringPromise])
  const [logs, subscription, schedules, wantaPendingPayment] = await Promise.all([
    settleWithSoftTimeout("logs", logsPromise),
    settleWithSoftTimeout("subscription", subscriptionPromise),
    settleWithSoftTimeout("schedules", schedulesPromise),
    settleWithSoftTimeout("wanta pending payment", wantaPendingPaymentPromise),
  ])
  logSettledFailure("balance", balance)
  logSettledFailure("spend", spend)
  logSettledFailure("metering", metering)
  logSettledFailure("logs", logs)
  logSettledFailure("subscription", subscription)
  logSettledFailure("schedules", schedules)
  logSettledFailure("wanta pending payment", wantaPendingPayment)
  if (balance.status === "rejected" && isBillingAuthRequiredReason(balance.reason)) {
    throw balance.reason
  }
  const criticalResults = [balance, spend, metering]
  if (criticalResults.every((result) => result.status === "rejected") && balance.status === "rejected") {
    throw balance.reason
  }
  return {
    balance: balance.status === "fulfilled" ? filterGeneralCreditUsages(balance.value) : null,
    spend: spend.status === "fulfilled" ? spend.value : null,
    metering: metering.status === "fulfilled" ? metering.value : null,
    logs: logs.status === "fulfilled" ? logs.value : [],
    subscription: subscription.status === "fulfilled" ? subscription.value : null,
    schedules: schedules.status === "fulfilled" ? schedules.value : [],
    wantaPendingPayment: wantaPendingPayment.status === "fulfilled" ? wantaPendingPayment.value : null,
  }
}

export async function updateWantaSubscription(
  payload: WantaSubscriptionChangePayload,
): Promise<WantaSubscriptionUpdateResult> {
  const url = new URL("/api/user/subscriptions/wanta", consoleServerBaseUrl)
  return readWantaSubscriptionUpdate(
    await oomolFetchJson<unknown>(url, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      timeoutMs: billingRequestTimeoutMs,
    }),
  )
}

export function billingPageUrl(target: BillingPageTarget): string {
  return billingUrl(target)
}

/** 结账（充值）URL：向 console-server 解析 Stripe 链接。解析后由调用方经 openExternalUrl IPC 交系统浏览器打开。 */
export async function topUpCheckoutUrl(price: RechargePrice): Promise<string> {
  const url = new URL("/api/user/web_top_up_url", consoleServerBaseUrl)
  url.searchParams.set("price", price)
  url.searchParams.set("redirect", checkoutReturnUrl())
  const checkoutUrl = unwrapConsoleData<string>(await fetchAuthenticatedJson(url))
  if (!checkoutUrl) {
    throw new Error("Top-up URL response is invalid.")
  }
  return ensureHttpUrl(checkoutUrl)
}

/** 订阅结账页：纯 URL 构造（无需网络），userId 由调用方从登录态传入。 */
export function subscriptionCheckoutUrl(plan: SubscriptionPlanTag, userId?: string): string {
  const url = new URL("/api/user/subscriptions/page", consoleServerBaseUrl)
  url.searchParams.set("payment_type", "subscription")
  url.searchParams.set("redirect", checkoutReturnUrl())
  url.searchParams.set("source_page", checkoutReturnUrl())
  url.searchParams.set("client_platform", "chat-web")
  url.searchParams.set("plan", plan)
  if (userId) {
    url.searchParams.set("user_id", userId)
  }
  return ensureHttpUrl(url.toString())
}

/** 订阅管理门户：向 console-server 解析 Stripe portal 链接。 */
export async function subscriptionPortalUrl(): Promise<string> {
  const url = new URL("/api/stripe/portal", consoleServerBaseUrl)
  url.searchParams.set("product", "ai")
  const portalUrl = unwrapConsoleData<string>(await fetchAuthenticatedJson(url))
  if (!portalUrl) {
    throw new Error("Subscription portal URL response is invalid.")
  }
  return ensureHttpUrl(portalUrl)
}

/** Wanta 订阅管理门户：Stripe portal 的 product 使用 wanta。 */
export async function wantaSubscriptionPortalUrl(): Promise<string> {
  const url = new URL("/api/stripe/portal", consoleServerBaseUrl)
  url.searchParams.set("product", "wanta")
  const portalUrl = unwrapConsoleData<string>(await fetchAuthenticatedJson(url))
  if (!portalUrl) {
    throw new Error("Wanta subscription portal URL response is invalid.")
  }
  return ensureHttpUrl(portalUrl)
}
