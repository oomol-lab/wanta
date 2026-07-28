// @vitest-environment happy-dom

import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nContext, translate } from "@/i18n/i18n"

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    login: vi.fn(async () => undefined),
  }),
}))

vi.mock("@/hooks/useBillableSeats", () => ({
  useBillableSeats: () => ({
    count: null,
    error: null,
    loading: false,
  }),
}))

vi.mock("@/hooks/useBillingOverview", () => ({
  useBillingOverview: () => ({
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
    },
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

async function renderPopover(workspaceSelection: WorkspaceSelection) {
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
          onViewDetails: vi.fn(),
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
})
