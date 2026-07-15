import type {
  BillingOverviewResult,
  BillingSpendStats,
  BillingSummaryResult,
  CreditBalanceResult,
  CreditItem,
  CreditUsages,
  RechargePrice,
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
const billingCreditUsagesMaxPages = 100

export interface BillingRequestScope {
  organizationId: string
  organizationName: string
  type: "organization"
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
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
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

function logSettledFailure(label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === "rejected") {
    console.warn("[wanta] billing overview request failed", { label, error: errorMessage(result.reason) })
    reportRendererHandledError("billingClient.request", `Billing overview request failed: ${label}`, result.reason)
  }
}

function billingScopeHeaders(scope?: BillingRequestScope): HeadersInit | undefined {
  if (!scope?.organizationName.trim()) {
    return undefined
  }
  return { "x-oo-organization-name": scope.organizationName }
}

function fetchAuthenticatedJson(url: URL, scope?: BillingRequestScope): Promise<unknown> {
  return oomolFetchJson<unknown>(url, {
    headers: billingScopeHeaders(scope),
    timeoutMs: billingRequestTimeoutMs,
  })
}

export async function getCreditBalance(scope: BillingRequestScope): Promise<CreditBalanceResult> {
  const url = new URL("/v1/balance/available", insightBaseUrl)
  return readCreditBalance(unwrapApiData<unknown>(await fetchAuthenticatedJson(url, scope)))
}

async function getCreditUsages(scope: BillingRequestScope, nextToken?: string): Promise<CreditUsages> {
  const url = new URL("/v1/balance/available", insightBaseUrl)
  if (nextToken) {
    url.searchParams.set("nextToken", nextToken)
  }
  return readCreditUsages(unwrapApiData<unknown>(await fetchAuthenticatedJson(url, scope)))
}

async function getAllCreditUsages(scope: BillingRequestScope): Promise<CreditUsages> {
  const firstPage = await getCreditUsages(scope)
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
    const nextPage = await getCreditUsages(scope, nextToken)
    if (nextPage.items.length === 0) {
      break
    }
    items.push(...nextPage.items)
    nextToken = nextPage.nextToken
    pageCount += 1
  }
  return { ...firstPage, items, nextToken: undefined }
}

async function getCreditSpendStats(days: number, scope: BillingRequestScope): Promise<BillingSpendStats> {
  const { endTime, startTime } = statsRange(days)
  const url = new URL("/v1/stats/billing", insightBaseUrl)
  url.searchParams.set("granularity", "daily")
  url.searchParams.set("startTime", String(startTime))
  url.searchParams.set("endTime", String(endTime))
  return unwrapApiData<BillingSpendStats>(await fetchAuthenticatedJson(url, scope))
}

async function getCreditMeteringStats(days: number, scope: BillingRequestScope): Promise<BillingSpendStats> {
  const { endTime, startTime } = statsRange(days)
  const url = new URL("/v1/stats/metering", insightBaseUrl)
  url.searchParams.set("granularity", "daily")
  url.searchParams.set("startTime", String(startTime))
  url.searchParams.set("endTime", String(endTime))
  return unwrapApiData<BillingSpendStats>(await fetchAuthenticatedJson(url, scope))
}

export async function getBillingSummary(days: number, scope: BillingRequestScope): Promise<BillingSummaryResult> {
  return getBillingOverview(days, scope)
}

export async function getBillingOverview(days: number, scope: BillingRequestScope): Promise<BillingOverviewResult> {
  const balancePromise = getAllCreditUsages(scope)
  const spendPromise = getCreditSpendStats(days, scope)
  const meteringPromise = getCreditMeteringStats(days, scope)
  const [balance, spend, metering] = await Promise.allSettled([balancePromise, spendPromise, meteringPromise])
  logSettledFailure("balance", balance)
  logSettledFailure("spend", spend)
  logSettledFailure("metering", metering)
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
  }
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
