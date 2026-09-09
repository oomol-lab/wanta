import type { BusyAction } from "./team-management-model.ts"

// @vitest-environment happy-dom
// Regression coverage for member addition while member reads/search are unavailable.
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { buildTeamMemberViews } from "./team-management-model.ts"
import { TeamMemberAdditionNotice, TeamMemberAccessButton } from "./TeamMembersPanel.tsx"
import { useTeamDetails } from "./use-team-details.ts"
import { useTeamMemberActions } from "./use-team-member-actions.ts"
import { clearTeamDetailsResources } from "@/lib/team-details-resource"

const { success } = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success, error: vi.fn() } }))
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: (key: string) => key }) }))

afterEach(() => {
  clearTeamDetailsResources()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const team = { id: "audit-team", name: "Audit", creator_user_id: "creator", avatar: "" }

async function mountProbe(input: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  let view!: {
    details: ReturnType<typeof useTeamDetails>
    actions: ReturnType<typeof useTeamMemberActions>
    addError: string | null
    open: boolean
  }
  function Probe() {
    const details = useTeamDetails({ activeAccountId: "creator", selectedTeam: team })
    const [addError, setAddMemberError] = React.useState<string | null>(null)
    const [open, setAddMemberOpen] = React.useState(true)
    const [, setBusyAction] = React.useState<BusyAction | null>(null)
    const actions = useTeamMemberActions({
      activeAccountId: "creator",
      actorRole: "creator",
      canManage: true,
      memberInput: input,
      memberSearch: { items: [], loading: false, query: input, error: "Search unavailable" },
      reloadDetails: details.reload,
      resetMemberSearch: () => {},
      selectedTeam: team,
      selectedSearchUserId: null,
      setAddMemberError,
      setAddMemberOpen,
      setBusyAction,
    })
    view = { details, actions, addError, open }
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(<Probe />))
  return { current: () => view, dispose: () => act(async () => root.unmount()) }
}

test.each(["http-500", "invalid-member"])(
  "committed add plus %s list failure retains an explicit addition receipt",
  async (failure) => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 204 })
      if (String(input).includes("/members")) {
        return failure === "http-500"
          ? Response.json({ message: "audit upstream failure" }, { status: 500 })
          : Response.json({ members: [{ user_id: "creator", role: "creator" }, { user_id: "added" }] })
      }
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const probe = await mountProbe("019fb724-1500-7d79-a783-1642d99ed93e")
    try {
      await act(async () => probe.current().actions.addMember({ preventDefault() {} } as React.FormEvent))
      const view = probe.current()
      expect(success).toHaveBeenCalledWith("teams.addMemberSuccess")
      expect(view.actions.addedMemberUserId).toBe("019fb724-1500-7d79-a783-1642d99ed93e")
      expect(view.open).toBe(false)
      expect(view.addError).toBeNull()
      expect(view.details.membersState.status).toBe("error")
      expect(view.details.membersState.data).toEqual([])
      expect(
        buildTeamMemberViews({
          account: { id: "creator", name: "Creator" },
          members: view.details.membersState.data,
          team,
          summaries: {},
        }).map((member) => member.user_id),
      ).toEqual(["creator"])
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
      expect(
        fetchMock.mock.calls.filter(([input, init]) => String(input).includes("/members") && !init?.method),
      ).toHaveLength(2)
    } finally {
      await probe.dispose()
    }
  },
)

test("failed username search never submits the username as user_id", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({ message: "user does not exist" }, { status: 400 })
      : Response.json({ members: [] }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const probe = await mountProbe("alice")
  try {
    await act(async () => probe.current().actions.addMember({ preventDefault() {} } as React.FormEvent))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(post).toBeUndefined()
    expect(probe.current().addError).toBe("teams.addMemberSelectRequired")
    expect(probe.current().open).toBe(true)
  } finally {
    await probe.dispose()
  }
})

test("addition receipt persists through read failure and offers only read retry and dismissal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div")
  const root = createRoot(host)
  const retry = vi.fn()
  const dismiss = vi.fn()
  try {
    await act(async () =>
      root.render(
        <>
          <TeamMemberAdditionNotice userId="added-user" failed onRetry={retry} onDismiss={dismiss} />
          <TeamMemberAccessButton
            canManage
            members={[]}
            membersComplete={false}
            membersLoading={false}
            onOpen={() => {}}
          />
        </>,
      ),
    )
    expect(host.textContent).toContain("teams.addMemberRefreshFailed")
    expect(host.textContent).toContain("teams.memberCountUnavailable")
    const buttons = host.querySelectorAll("button")
    await act(async () => buttons[0].click())
    expect(retry).toHaveBeenCalledOnce()
    await act(async () => buttons[1].click())
    expect(dismiss).toHaveBeenCalledOnce()
    await act(async () =>
      root.render(<TeamMemberAdditionNotice userId="added-user" failed={false} onRetry={retry} onDismiss={dismiss} />),
    )
    expect(host.textContent).not.toContain("teams.addMemberRefreshFailed")
    expect(host.textContent).toContain("teams.addMemberConfirmed")
  } finally {
    await act(async () => root.unmount())
  }
})

test("two submissions while the write is pending send only one POST", async () => {
  let complete!: (response: Response) => void
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
    init?.method === "POST"
      ? new Promise<Response>((resolve) => {
          complete = resolve
        })
      : Response.json({ members: [] }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const probe = await mountProbe("019fb724-1500-7d79-a783-1642d99ed93e")
  try {
    await act(async () => {
      const first = probe.current().actions.addMember({ preventDefault() {} } as React.FormEvent)
      await probe.current().actions.addMember({ preventDefault() {} } as React.FormEvent)
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
      complete(new Response(null, { status: 204 }))
      await first
    })
    expect(probe.current().actions.addedMemberUserId).not.toBeNull()
  } finally {
    await probe.dispose()
  }
})
