// @vitest-environment happy-dom

import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nContext, translate } from "@/i18n/i18n"

const mockBilling = vi.hoisted(() => ({
  data: {
    balance: null,
    balanceAvailable: false,
    metering: null,
    meteringAvailable: false,
    spend: null,
    spendAvailable: false,
    subscription: null,
    subscriptionAvailable: false,
    teamPendingPayment: null,
    teamPendingPaymentAvailable: false,
  } as Record<string, unknown>,
  seatCount: null as number | null,
}))

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    login: vi.fn(async () => undefined),
  }),
}))

vi.mock("@/hooks/useBillableSeats", () => ({
  useBillableSeats: () => ({
    count: mockBilling.seatCount,
    error: null,
    loading: false,
  }),
}))

vi.mock("@/hooks/useBillingOverview", () => ({
  useBillingOverview: () => ({
    data: mockBilling.data,
    error: null,
    loading: false,
    refresh: vi.fn(async () => null),
  }),
}))

import { BillingUsagePopover } from "./BillingUsagePopover.tsx"

const workspace: WorkspaceSelection = {
  canManage: true,
  kind: "team",
  role: "creator",
  team: {
    avatar: "",
    creator_user_id: "account-1",
    id: "team-1",
    name: "Test team",
  },
  teamId: "team-1",
}

afterEach(() => {
  document.body.replaceChildren()
})

beforeEach(() => {
  mockBilling.seatCount = null
  mockBilling.data = {
    balance: null,
    balanceAvailable: false,
    metering: null,
    meteringAvailable: false,
    spend: null,
    spendAvailable: false,
    subscription: null,
    subscriptionAvailable: false,
    teamPendingPayment: null,
    teamPendingPaymentAvailable: false,
  }
})

async function renderPopover(workspaceSelection: WorkspaceSelection, onViewDetails = vi.fn()) {
  const titlebar = document.createElement("header")
  titlebar.style.overflow = "hidden"
  document.body.append(titlebar)
  const root = createRoot(titlebar)
  await act(async () => {
    root.render(
      React.createElement(
        I18nContext.Provider,
        {
          value: {
            locale: "zh-CN",
            setLocale: () => undefined,
            t: (key, vars) => translate("zh-CN", key, vars),
          },
        },
        React.createElement(BillingUsagePopover, {
          cacheScope: "test",
          onViewDetails,
          workspace: workspaceSelection,
        }),
      ),
    )
  })
  const trigger = titlebar.querySelector<HTMLButtonElement>('[aria-label="计划与用量"]')
  await act(async () => {
    trigger?.click()
  })
  return { root, titlebar }
}

function setAvailablePlan(plan: "team_plus" | "team_pro" | null) {
  mockBilling.seatCount = 2
  mockBilling.data = {
    ...mockBilling.data,
    subscription: {
      features: [],
      plan,
      plans: [],
      platforms: {},
    },
    subscriptionAvailable: true,
    teamPendingPaymentAvailable: true,
  }
}

describe("BillingUsagePopover", () => {
  it("portals the panel beyond the overflow-hidden titlebar", async () => {
    const { root, titlebar } = await renderPopover(workspace)

    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    expect(content).not.toBeNull()
    expect(titlebar.contains(content)).toBe(false)
    expect(content?.getAttribute("aria-label")).toBe("计划与用量")

    act(() => root.unmount())
  })

  it("keeps the creator plan card visible when plan requests are unavailable", async () => {
    const { root } = await renderPopover(workspace)
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')

    expect(content?.textContent).toContain("当前计划与席位")
    expect(content?.textContent).toContain("计划与席位数据暂不可用")
    expect(content?.textContent).toContain("暂时无法读取当前 Team 计划或待支付状态")

    act(() => root.unmount())
  })

  it("does not show the plan card to a team admin", async () => {
    const { root } = await renderPopover({
      ...workspace,
      canManage: true,
      role: "admin",
    })
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')

    expect(content?.textContent).not.toContain("当前计划与席位")
    expect(content?.textContent).not.toContain("计划与席位数据暂不可用")

    act(() => root.unmount())
  })

  it("shows the balance directly without an ambiguous original-credit progress bar", async () => {
    mockBilling.data = {
      ...mockBilling.data,
      balance: {
        items: [],
        total: {
          currentCredit: "89.03",
          originalCredit: "445.15",
        },
      },
      balanceAvailable: true,
    }
    const { root } = await renderPopover(workspace)
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')

    expect(content?.textContent).toContain("$89.03")
    expect(content?.querySelector('[role="progressbar"]')).toBeNull()

    act(() => root.unmount())
  })

  it("routes the whole inactive plan card to plan selection", async () => {
    setAvailablePlan(null)
    const onViewDetails = vi.fn()
    const { root } = await renderPopover(workspace, onViewDetails)
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    const planCard = Array.from(content?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("升级 Team 计划"),
    )

    expect(planCard).toBeDefined()
    expect(planCard?.textContent).toContain("Team 协作计划")
    expect(planCard?.textContent).toContain("统一管理成员和权限")
    expect(planCard?.textContent).toContain("仍从下方个人用量账户扣除")
    const upgradeAction = Array.from(planCard?.querySelectorAll("span") ?? []).find(
      (element) => element.textContent?.trim() === "升级 Team 计划",
    )
    expect(upgradeAction?.className).not.toContain("border")
    expect(upgradeAction?.className).toContain("group-hover:underline")
    const inactiveBadge = Array.from(planCard?.querySelectorAll('[data-slot="badge"]') ?? []).find(
      (badge) => badge.textContent === "未启用",
    )
    expect(inactiveBadge?.getAttribute("data-variant")).toBe("muted")
    await act(async () => planCard?.click())
    expect(onViewDetails).toHaveBeenCalledWith("plans")

    act(() => root.unmount())
  })

  it("offers upgrade for Plus and keeps recharge as the primary balance action", async () => {
    setAvailablePlan("team_plus")
    const onViewDetails = vi.fn()
    const { root } = await renderPopover(workspace, onViewDetails)
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')

    expect(content?.textContent).toContain("升级 Team 计划")
    const topUp = Array.from(content?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "充值余额",
    )
    expect(topUp).toBeDefined()
    await act(async () => topUp?.click())
    expect(onViewDetails).toHaveBeenCalledWith("credits")

    act(() => root.unmount())
  })

  it("does not show an upgrade action for the highest Team plan", async () => {
    setAvailablePlan("team_pro")
    const { root } = await renderPopover(workspace)
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')

    expect(content?.textContent).toContain("Team Pro")
    expect(content?.textContent).not.toContain("升级 Team 计划")
    expect(content?.textContent).toContain("充值余额")

    act(() => root.unmount())
  })

  it("keeps the compact details footer fully clickable", async () => {
    const onViewDetails = vi.fn()
    const { root } = await renderPopover(workspace, onViewDetails)
    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    const details = Array.from(content?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "查看详情",
    )

    expect(details).toBeDefined()
    expect(details?.className).toContain("h-10")
    await act(async () => details?.click())
    expect(onViewDetails).toHaveBeenCalledWith(undefined)

    act(() => root.unmount())
  })
})
