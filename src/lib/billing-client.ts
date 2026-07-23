import type {
  BillingOverviewResult,
  BillingSpendStats,
  CreditBalanceResult,
  CreditItem,
  CreditUsages,
  RechargePrice,
  SubscriptionStatus,
  TeamSubscriptionChangePayload,
  TeamSubscriptionPreviewResult,
  TeamSubscriptionUpdateResult,
  TeamPendingPaymentResult,
  TeamSubscriptionPlan,
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
const billingCreditUsagesMaxPages = 100
// Keep usage windows bounded even when a caller passes a raw number outside BillingPeriodDays.
const statsMaxWindowDays = 30
export const teamSubscriptionPlans: readonly TeamSubscriptionPlan[] = ["team_plus", "team_pro"]

export interface BillingRequestScope {
  canManageFunding: boolean
  canManageTeamSubscription: boolean
  canReadTeamSubscription: boolean
  teamId: string
  teamName: string
}

/** 会话过期/缺失的哨兵文案（与 oomol-http 的 authRequiredMessage 同字面量）；resolveUserFacingError 据此归为 auth_required。 */
export const billingAuthRequiredMessage = authRequiredMessage

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

function readTeamPendingPayment(payload: unknown): TeamPendingPaymentResult | null {
  const source = unwrapConsoleData<unknown>(payload)
  if (!source || typeof source !== "object") {
    return null
  }
  const record = source as Record<string, unknown>
  return {
    subscriptionID: readStringField(record, ["subscriptionID", "subscriptionId", "subscription_id"]),
    status: readStringField(record, ["status"]),
    plan: isTeamSubscriptionPlan(record["plan"]) ? record["plan"] : null,
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

function readTeamSubscriptionUpdate(payload: unknown): TeamSubscriptionUpdateResult {
  const source = unwrapConsoleData<unknown>(payload)
  if (!source || typeof source !== "object") {
    throw new Error("Team subscription response is invalid.")
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

function readTeamSubscriptionPreview(payload: unknown): TeamSubscriptionPreviewResult {
  const source = unwrapConsoleData<unknown>(payload)
  if (!source || typeof source !== "object") {
    throw new Error("Team subscription preview response is invalid.")
  }
  const record = source as Record<string, unknown>
  return {
    amountDue: readOptionalNumberField(record, ["amountDue", "amount_due"]) ?? 0,
    changeTiming:
      record["changeTiming"] === "next_cycle" || record["change_timing"] === "next_cycle" ? "next_cycle" : "immediate",
    currency: readStringField(record, ["currency"]),
    mode: record["mode"] === "update" ? "update" : "create",
    targetAdditionalSeats: readIntegerField(record, ["targetAdditionalSeats", "target_additional_seats"]),
    targetPlan: readPlanField(record, ["targetPlan", "target_plan"]),
    total: readOptionalNumberField(record, ["total"]) ?? 0,
  }
}

function readPlanField(record: Record<string, unknown>, keys: string[]): TeamSubscriptionPlan | null {
  for (const key of keys) {
    const value = record[key]
    if (isTeamSubscriptionPlan(value)) {
      return value
    }
  }
  return null
}

function isTeamSubscriptionPlan(value: unknown): value is TeamSubscriptionPlan {
  return typeof value === "string" && teamSubscriptionPlans.includes(value as TeamSubscriptionPlan)
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
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), statsMaxWindowDays) : 30
  const endTime = Date.now()
  return { endTime, startTime: endTime - normalizedDays * dayMs }
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

// Subset of insight's /v2/stats/team/:teamId/{billing,metering} response we consume. V2 dropped the
// per-bucket `subject` from the time series (it now lives only in subjectTotals), so a series item
// carries just time/source plus the mode-dependent totalCredit | totalUsage | eventCount.
interface TeamStatsV2Response {
  items?: {
    time?: number
    source?: string
    totalCredit?: string
    totalUsage?: string
    eventCount?: number
  }[]
  sourceTotals?: Record<string, { totalCredit?: string; totalUsage?: string; eventCount?: number }>
  total?: { totalCredit?: string; totalUsage?: string; eventCount?: number }
}

// Adapt the breaking V2 stats payload into the internal BillingSpendStats DTO the usage view reads.
// Series items lose `subject` (set to "" so usageCategory falls back to source-based classification,
// which is exact for the real SERVICE_* sources); total/sourceTotals map through unchanged.
function adaptTeamStatsResponse(payload: unknown): BillingSpendStats {
  const data = unwrapApiData<TeamStatsV2Response>(payload)
  const items = Array.isArray(data.items) ? data.items : []
  return {
    items: items.map((item) => ({
      source: item.source ?? "",
      subject: "",
      time: item.time ?? 0,
      totalCredit: item.totalCredit,
      totalUsage: item.totalUsage,
      eventCount: item.eventCount,
    })),
    sourceTotals: data.sourceTotals ?? {},
    total: data.total ?? {},
  }
}

function logSettledFailure(label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === "rejected") {
    console.warn("[wanta] billing overview request failed", { label, error: errorMessage(result.reason) })
    reportRendererHandledError("billingClient.request", `Billing overview request failed: ${label}`, result.reason)
  }
}

function billingScopeHeaders(scope?: BillingRequestScope): HeadersInit | undefined {
  if (!scope?.teamName.trim()) {
    return undefined
  }
  return { "x-oo-organization-name": scope.teamName }
}

function fetchAuthenticatedJson(url: URL, scope?: BillingRequestScope, signal?: AbortSignal): Promise<unknown> {
  return oomolFetchJson<unknown>(url, {
    headers: billingScopeHeaders(scope),
    signal,
    timeoutMs: billingRequestTimeoutMs,
  })
}

export async function getCreditBalance(scope: BillingRequestScope, signal?: AbortSignal): Promise<CreditBalanceResult> {
  const url = new URL("/v1/balance/available", insightBaseUrl)
  return readCreditBalance(unwrapApiData<unknown>(await fetchAuthenticatedJson(url, undefined, signal)))
}

async function getCreditUsages(nextToken?: string, signal?: AbortSignal): Promise<CreditUsages> {
  const url = new URL("/v1/balance/available", insightBaseUrl)
  if (nextToken) {
    url.searchParams.set("nextToken", nextToken)
  }
  return readCreditUsages(unwrapApiData<unknown>(await fetchAuthenticatedJson(url, undefined, signal)))
}

async function getAllCreditUsages(signal?: AbortSignal): Promise<CreditUsages> {
  const firstPage = await getCreditUsages(undefined, signal)
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
    const nextPage = await getCreditUsages(nextToken, signal)
    if (nextPage.items.length === 0) {
      break
    }
    items.push(...nextPage.items)
    nextToken = nextPage.nextToken
    pageCount += 1
  }
  return { ...firstPage, items, nextToken: undefined }
}

const meteringExcludeSubjects = [
  "SERVICE_OOMOL_CONNECTOR:service-fusion-api-free",
  "SERVICE_OOMOL_CONNECTOR:service-fusion-api",
  "SERVICE_OOMOL_CONNECTOR:fusion-api",
  "SERVICE_AUTH_LINK:service-fusion-api-free",
  "SERVICE_AUTH_LINK:service-fusion-api",
  "SERVICE_AUTH_LINK:fusion-api",
].join(",")

// Insight V2 billing data is personal account data. Team identity deliberately does not participate:
// team plans/seats are workspace-scoped, while balance and charged usage belong to the signed-in user.
async function getCreditSpendStats(
  days: number,
  _scope: BillingRequestScope,
  signal?: AbortSignal,
): Promise<BillingSpendStats> {
  const { endTime, startTime } = statsRange(days)
  const url = new URL("/v2/stats/billing", insightBaseUrl)
  url.searchParams.set("granularity", "daily")
  url.searchParams.set("startTime", String(startTime))
  url.searchParams.set("endTime", String(endTime))
  return adaptTeamStatsResponse(await fetchAuthenticatedJson(url, undefined, signal))
}

async function getCreditMeteringStats(
  days: number,
  _scope: BillingRequestScope,
  signal?: AbortSignal,
): Promise<BillingSpendStats> {
  const { endTime, startTime } = statsRange(days)
  const url = new URL("/v2/stats/metering", insightBaseUrl)
  url.searchParams.set("granularity", "daily")
  url.searchParams.set("startTime", String(startTime))
  url.searchParams.set("endTime", String(endTime))
  url.searchParams.set("excludeSubjects", meteringExcludeSubjects)
  return adaptTeamStatsResponse(await fetchAuthenticatedJson(url, undefined, signal))
}

async function getSubscriptionStatus(
  scope: BillingRequestScope,
  signal?: AbortSignal,
): Promise<SubscriptionStatus | null> {
  if (!scope.canReadTeamSubscription) {
    return null
  }
  const url = new URL(`/api/org/${encodeURIComponent(scope.teamId)}/subscriptions`, consoleServerBaseUrl)
  return unwrapConsoleData<SubscriptionStatus>(await fetchAuthenticatedJson(url, undefined, signal))
}

async function getTeamPendingPayment(
  scope: BillingRequestScope,
  signal?: AbortSignal,
): Promise<TeamPendingPaymentResult | null> {
  if (!scope.canReadTeamSubscription) {
    return null
  }
  const url = new URL(
    `/api/team/${encodeURIComponent(scope.teamId)}/subscriptions/team/pending_payment`,
    consoleServerBaseUrl,
  )
  return readTeamPendingPayment(await fetchAuthenticatedJson(url, undefined, signal))
}

function optionalBillingSignal(signal?: AbortSignal): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error("Optional billing request timed out."))
  }, billingOptionalRequestSoftTimeoutMs)
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener("abort", abort, { once: true })
  }
  return {
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    },
    signal: controller.signal,
  }
}

function settleOnAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void request.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort)
    })
    if (signal.aborted) {
      abort()
    }
  })
}

export async function getBillingOverview(
  days: number,
  scope: BillingRequestScope,
  signal?: AbortSignal,
): Promise<BillingOverviewResult> {
  // Team plan details follow the workspace. Balance, spend, and metering are always the signed-in
  // user's personal account, matching Console and the identity used by Wanta's built-in model calls.
  const balancePromise = getAllCreditUsages(signal)
  const spendPromise = getCreditSpendStats(days, scope, signal)
  const meteringPromise = getCreditMeteringStats(days, scope, signal)
  const detailsRequest = optionalBillingSignal(signal)
  const subscriptionPromise = settleOnAbort(getSubscriptionStatus(scope, detailsRequest.signal), detailsRequest.signal)
  const teamPendingPaymentPromise = settleOnAbort(
    getTeamPendingPayment(scope, detailsRequest.signal),
    detailsRequest.signal,
  )

  const [balance, spend, metering] = await Promise.allSettled([balancePromise, spendPromise, meteringPromise])
  const [subscription, teamPendingPayment] = await Promise.allSettled([subscriptionPromise, teamPendingPaymentPromise])
  detailsRequest.cleanup()
  if (signal?.aborted) {
    throw signal.reason
  }
  logSettledFailure("balance", balance)
  logSettledFailure("spend", spend)
  logSettledFailure("metering", metering)
  logSettledFailure("subscription", subscription)
  logSettledFailure("team pending payment", teamPendingPayment)
  const criticalResults: PromiseSettledResult<unknown>[] = [balance, spend, metering]
  const authFailure = criticalResults.find(
    (result) => result.status === "rejected" && isBillingAuthRequiredReason(result.reason),
  )
  if (authFailure?.status === "rejected") {
    throw authFailure.reason
  }
  const firstFailure = criticalResults.find((result) => result.status === "rejected")
  if (criticalResults.every((result) => result.status === "rejected") && firstFailure?.status === "rejected") {
    throw firstFailure.reason
  }
  return {
    balance: balance.status === "fulfilled" && balance.value ? filterGeneralCreditUsages(balance.value) : null,
    spend: spend.status === "fulfilled" ? spend.value : null,
    metering: metering.status === "fulfilled" ? metering.value : null,
    subscription: subscription.status === "fulfilled" ? subscription.value : null,
    subscriptionAvailable: subscription.status === "fulfilled",
    teamPendingPayment: teamPendingPayment.status === "fulfilled" ? teamPendingPayment.value : null,
    teamPendingPaymentAvailable: teamPendingPayment.status === "fulfilled",
  }
}

export async function updateTeamSubscription(
  teamId: string,
  payload: TeamSubscriptionChangePayload,
): Promise<TeamSubscriptionUpdateResult> {
  const url = new URL(`/api/team/${encodeURIComponent(teamId)}/subscriptions/team`, consoleServerBaseUrl)
  return readTeamSubscriptionUpdate(
    await oomolFetchJson<unknown>(url, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      timeoutMs: billingRequestTimeoutMs,
    }),
  )
}

export async function previewTeamSubscription(
  teamId: string,
  payload: TeamSubscriptionChangePayload,
): Promise<TeamSubscriptionPreviewResult> {
  const url = new URL(`/api/team/${encodeURIComponent(teamId)}/subscriptions/team/preview`, consoleServerBaseUrl)
  return readTeamSubscriptionPreview(
    await oomolFetchJson<unknown>(url, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      timeoutMs: billingRequestTimeoutMs,
    }),
  )
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
