// @vitest-environment happy-dom
import type { TeamPendingPaymentResult } from "../../../electron/chat/common.ts"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { TeamSubscriptionSchedulePanel } from "./BillingSubscriptionPanels.tsx"
import { useTeamCheckout } from "./use-team-checkout.ts"
import { I18nContext, translate } from "@/i18n/i18n"
import { cancelTeamSubscriptionSchedule } from "@/lib/billing-client"

vi.mock("@/lib/billing-client", () => ({
  cancelTeamSubscriptionSchedule: vi.fn(async () => ({ scheduledUpdate: false })),
  previewTeamSubscription: vi.fn(),
  updateTeamSubscription: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const pending: TeamPendingPaymentResult = {
  subscriptionID: "sub",
  status: "active",
  plan: "team_plus",
  additionalSeats: 3,
  targetPlan: null,
  targetAdditionalSeats: 0,
  currentPeriodEnd: 1_800_000_000,
  latestInvoiceID: null,
  paymentRequired: false,
  paymentURL: null,
  invoiceStatus: null,
  amountRemaining: null,
  currency: null,
  pendingUpdate: false,
  pendingUpdateExpiresAt: null,
  scheduledUpdate: true,
  scheduledEffectiveAt: 1_800_000_000,
}
let root: Root | undefined
let host: HTMLDivElement
const refresh = vi.fn()
const openCheckout = vi.fn(async () => {})
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function mount(canManage: boolean, payment = pending) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  function Probe() {
    const checkout = useTeamCheckout({
      teamId: "team-1",
      currentAdditionalSeats: 3,
      pendingAdditionalSeats: null,
      pendingPlan: null,
      pendingPaymentUrl: payment.paymentURL,
      refresh,
      openExternalCheckout: openCheckout,
    })
    return (
      <TeamSubscriptionSchedulePanel
        pendingPayment={payment}
        canManage={canManage}
        disabled={checkout.loading !== null}
        onCancel={() => void checkout.cancelSchedule()}
        onContinuePayment={() => void checkout.continuePayment()}
      />
    )
  }
  await act(async () =>
    root!.render(
      <I18nContext.Provider value={{ locale: "en", t: (key, vars) => translate("en", key, vars), setLocale: () => {} }}>
        <Probe />
      </I18nContext.Provider>,
    ),
  )
}
test("renders a scheduled cancellation and lets the creator cancel it", async () => {
  await mount(true)
  expect(host.textContent).toContain("Scheduled subscription change")
  expect(host.textContent).toContain(translate("en", "billing.teamNoPlan"))
  expect(host.textContent).toContain(new Date(1_800_000_000 * 1000).toLocaleDateString("en"))
  await act(async () => host.querySelector("button")!.click())
  expect(cancelTeamSubscriptionSchedule).toHaveBeenCalledWith("team-1")
  expect(refresh).toHaveBeenCalledOnce()
  expect(openCheckout).not.toHaveBeenCalled()
})
test("read-only subscription viewers see the schedule without mutation controls", async () => {
  await mount(false)
  expect(host.textContent).toContain("Scheduled subscription change")
  expect(host.querySelector("button")).toBeNull()
})
test("a pending checkout without a target plan still has a working payment action", async () => {
  await mount(true, {
    ...pending,
    scheduledUpdate: false,
    paymentRequired: true,
    paymentURL: "https://example.com/pay",
  })
  await act(async () => host.querySelector("button")!.click())
  expect(openCheckout).toHaveBeenCalledWith("https://example.com/pay")
  expect(cancelTeamSubscriptionSchedule).not.toHaveBeenCalled()
})
