// @vitest-environment happy-dom
import type { SubscriptionStatus } from "../../../electron/chat/common.ts"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { useTeamSeatLimit } from "./use-team-seat-limit.ts"
import { getTeamSubscriptionStatus } from "@/lib/billing-client"

vi.mock("@/lib/billing-client", () => ({ getTeamSubscriptionStatus: vi.fn() }))
function subscription(maxMembers: number): SubscriptionStatus {
  return {
    plan: null,
    plans: [],
    features: [],
    platforms: {},
    team: { additionalSeats: 0, cached: false, updatedAt: null, maxMembers },
  }
}
test("seat preflight excludes guest accounts and ignores results from the previous team", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  let resolveFirst!: (status: SubscriptionStatus) => void
  vi.mocked(getTeamSubscriptionStatus)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    .mockResolvedValueOnce(subscription(2))
    .mockResolvedValueOnce(subscription(0))
  let view!: ReturnType<typeof useTeamSeatLimit>
  function Probe({ teamId }: { teamId: string }) {
    view = useTeamSeatLimit({
      teamId,
      accountId: "user",
      enabled: true,
      membersStatus: "ready",
      members: [
        { user_id: "user", role: "creator" },
        { user_id: "guest", user_type: "service-account", role: "guest" },
      ],
    })
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe teamId="first" />))
    expect(view.loading).toBe(true)
    await act(async () => root.render(<Probe teamId="second" />))
    expect(view).toEqual({ loading: false, reached: false })
    await act(async () => resolveFirst(subscription(0)))
    expect(view.reached).toBe(false)
    await act(async () => root.render(<Probe teamId="zero-capacity" />))
    expect(view).toEqual({ loading: false, reached: true })
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  }
})

test("seat preflight waits for member reads and releases the guard after a terminal read failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getTeamSubscriptionStatus).mockResolvedValue(subscription(1))
  let view!: ReturnType<typeof useTeamSeatLimit>
  function Probe({ status }: { status: "idle" | "loading" | "ready" | "error" }) {
    view = useTeamSeatLimit({
      teamId: "members-pending",
      accountId: "user",
      enabled: true,
      membersStatus: status,
      members: [{ user_id: "user", role: "creator" }],
    })
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe status="idle" />))
    expect(view).toEqual({ loading: true, reached: false })
    await act(async () => root.render(<Probe status="loading" />))
    expect(view).toEqual({ loading: true, reached: false })
    await act(async () => root.render(<Probe status="ready" />))
    expect(view).toEqual({ loading: false, reached: true })
    await act(async () => root.render(<Probe status="error" />))
    expect(view).toEqual({ loading: false, reached: false })
    expect(getTeamSubscriptionStatus).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  }
})
