// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { refreshAfterCommittedTeamMutation } from "./team-management-model.ts"
import { TeamDetailPanel } from "./TeamMembersPanel.tsx"
import { TeamSkillManagePanel } from "./TeamSkillManagePanel.tsx"
import { useTeamDetails } from "./use-team-details.ts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useTeamWorkspace } from "@/hooks/useTeamWorkspace"
import { clearTeamDetailsResources, invalidateTeamDetailsResource } from "@/lib/team-details-resource"

const { rowRender, translate } = vi.hoisted(() => ({ rowRender: vi.fn(() => null), translate: (key: string) => key }))
vi.mock("./SkillListRow.tsx", () => ({ SkillListRow: rowRender }))
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: translate, locale: "en" }) }))
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
afterEach(() => {
  clearTeamDetailsResources()
  vi.unstubAllGlobals()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
})

test("configured rows skip unchanged actions and progress while preserving global disable updates", async () => {
  const root = createRoot(document.createElement("div"))
  const props: React.ComponentProps<typeof TeamSkillManagePanel> = {
    busyAction: null,
    groupById: new Map(),
    providerRecommendations: [],
    onAddRecommendation: vi.fn(),
    onAddRecommendationBatch: vi.fn(),
    onAddMarketPackage: vi.fn(),
    onInstallRuntimeSkill: vi.fn(),
    onInstallRuntimeSkills: vi.fn(),
    onOpenManagedSkill: vi.fn(),
    onOpenPackageDetail: vi.fn(),
    teamSkills: {
      teamId: "audit-team",
      teamName: "Audit",
      canManage: true,
      apiEnabled: true,
      loading: false,
      hasLoaded: true,
      error: null,
      chatContextSkills: [],
      addSkill: vi.fn(),
      removePackage: vi.fn(),
      refresh: vi.fn(),
      skills: Array.from({ length: 100 }, (_, i) => ({
        id: `s${i}`,
        displayName: `Skill ${i}`,
        enabled: true,
        order: i,
        packageName: `p${i}`,
        skillName: `s${i}`,
        version: "1",
        versionPolicy: "pinned",
        visibility: "public",
      })),
    },
  }
  try {
    await act(async () => root.render(<TeamSkillManagePanel {...props} />))
    rowRender.mockClear()
    await act(async () => root.render(<TeamSkillManagePanel {...props} busyAction="addSkill:unrelated:skill" />))
    expect(rowRender).toHaveBeenCalledTimes(100) // Global action disabling changes every row.
    rowRender.mockClear()
    await act(async () =>
      root.render(
        <TeamSkillManagePanel
          {...props}
          busyAction="addSkill:another:skill"
          providerRecommendationsResolvedCount={1}
        />,
      ),
    )
    expect(rowRender).not.toHaveBeenCalled()
    await act(async () =>
      root.render(
        <TeamSkillManagePanel {...props} busyAction="installSkill:p12:s12" providerRecommendationsResolvedCount={1} />,
      ),
    )
    expect(rowRender).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
  }
})

test("leaving team details prevents subsequent summaries requests", async () => {
  let resolveMembers!: (r: Response) => void
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMembers = resolve
        }),
    )
    .mockResolvedValue(Response.json({ u: { username: "User" } }))
  vi.stubGlobal("fetch", fetchMock)
  let view!: ReturnType<typeof useTeamDetails>
  function Probe() {
    view = useTeamDetails({
      activeAccountId: "u",
      selectedTeam: { id: "t", name: "Team", creator_user_id: "u", avatar: "" },
    })
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(<Probe />))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  await act(async () => resolveMembers(Response.json({ members: [{ user_id: "u", role: "creator" }] })))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await view.reload()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("member mutations reuse all 201 user summaries", async () => {
  const members = Array.from({ length: 201 }, (_, i) => ({ user_id: `u${i}`, role: i === 0 ? "creator" : "member" }))
  const fetchMock = vi.fn(async (input: URL | string) =>
    String(input).includes("/members") ? Response.json({ members }) : Response.json({}),
  )
  vi.stubGlobal("fetch", fetchMock)
  let view!: ReturnType<typeof useTeamDetails>
  function Probe() {
    view = useTeamDetails({
      activeAccountId: "u0",
      selectedTeam: { id: "t", name: "Team", creator_user_id: "u0", avatar: "" },
    })
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    fetchMock.mockClear()
    invalidateTeamDetailsResource("u0", "t", { preserveUserSummaries: true })
    await act(async () => view.reload())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const summaryCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/summaries"))
    expect(summaryCalls.map(([input]) => new URL(input).searchParams.getAll("user_ids").length)).toEqual([])
  } finally {
    await act(async () => root.unmount())
  }
})

test("post-mutation refresh exposes failure without treating the write as failed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("failed", { status: 500 })),
  )
  let view!: ReturnType<typeof useTeamWorkspace>
  function Probe() {
    view = useTeamWorkspace("audit-refresh-error-account")
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    const onFailure = vi.fn()
    let result: boolean | undefined
    await act(async () => {
      result = await refreshAfterCommittedTeamMutation(
        () => view.refresh({ forceRefresh: true, throwOnError: true }),
        onFailure,
      )
    })
    expect(view.error).not.toBeNull()
    expect(result).toBe(false)
    expect(onFailure).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
  }
})

test("preview summaries load only visible users and opening members fetches missing profiles", async () => {
  const members = Array.from({ length: 201 }, (_, i) => ({ user_id: `u${i}`, role: i === 0 ? "creator" : "member" }))
  const summaryBatches: string[][] = []
  const fetchMock = vi.fn(async (input: URL | string) => {
    if (String(input).includes("/members")) return Response.json({ members })
    const ids = new URL(input).searchParams.getAll("user_ids")
    summaryBatches.push(ids)
    return Response.json(Object.fromEntries(ids.map((id) => [id, { username: id, nickname: id }])))
  })
  vi.stubGlobal("fetch", fetchMock)
  let view!: ReturnType<typeof useTeamDetails>
  const team = { id: "preview-team", name: "Preview", creator_user_id: "u0", avatar: "" }
  function Probe({ full }: { full: boolean }) {
    view = useTeamDetails({ activeAccountId: "u0", selectedTeam: team, includeAllSummaries: full })
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe full={false} />))
    expect(summaryBatches).toEqual([["u0", "u1", "u2", "u3"]])
    expect(view.membersState.data).toHaveLength(201)
    await act(async () => root.render(<Probe full />))
    expect(summaryBatches.map((ids) => ids.length)).toEqual([4, 100, 97])
    expect(new Set(summaryBatches.flat()).size).toBe(201)
    expect(summaryBatches.flat()).toHaveLength(201)
    expect(Object.keys(view.summariesState.data)).toHaveLength(201)
    await act(async () => root.render(<Probe full={false} />))
    await act(async () => root.render(<Probe full />))
    expect(summaryBatches).toHaveLength(3)
  } finally {
    await act(async () => root.unmount())
  }
})

test("members remain visible during revalidation and old-team completions are ignored", async () => {
  let pending: ((response: Response) => void) | undefined
  let hold = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      if (!String(input).includes("/members")) return Response.json({})
      if (hold && String(input).includes("/team-old/"))
        return new Promise<Response>((resolve) => {
          pending = resolve
        })
      return Response.json({
        members: [{ user_id: String(input).includes("/team-old/") ? "old" : "new", role: "creator" }],
      })
    }),
  )
  let view!: ReturnType<typeof useTeamDetails>
  function Probe({ id }: { id: string }) {
    view = useTeamDetails({
      activeAccountId: "actor",
      selectedTeam: { id, name: id, creator_user_id: "actor", avatar: "" },
    })
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe id="team-old" />))
    hold = true
    let reload!: Promise<void>
    await act(async () => {
      reload = view.reload()
    })
    expect(view.membersState.status).toBe("loading")
    expect(view.membersState.data[0]?.user_id).toBe("old")
    await act(async () => root.render(<Probe id="team-new" />))
    await act(async () => {
      pending?.(Response.json({ members: [{ user_id: "late", role: "creator" }] }))
      await reload
    })
    expect(view.membersState.data[0]?.user_id).toBe("new")
  } finally {
    await act(async () => root.unmount())
  }
})

test("member selection and DOM survive background refresh and a refresh failure", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const props: React.ComponentProps<typeof TeamDetailPanel> = {
    actorRole: "creator",
    actorUserId: "creator",
    busyAction: null,
    canManage: true,
    members: [
      {
        user_id: "member",
        role: "member",
        disable: false,
        avatar: "",
        displayName: "Member",
        fallback: "M",
        secondaryLabel: "member",
      },
    ],
    membersComplete: true,
    membersError: null,
    membersForbidden: false,
    membersLoading: false,
    team: { id: "t", name: "Team", creator_user_id: "creator", avatar: "" },
    onAddMember: vi.fn(),
    onDisableMembers: vi.fn(),
    onEnableMembers: vi.fn(),
    onRemoveMember: vi.fn(),
    onRetryMembers: vi.fn(),
    onUpdateMemberRole: vi.fn(),
  }
  try {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <TeamDetailPanel {...props} />
        </TooltipProvider>,
      ),
    )
    const checkbox = host.querySelector<HTMLInputElement>('input[aria-label="teams.selectMember"]')!
    await act(async () => checkbox.click())
    expect(checkbox.checked).toBe(true)
    await act(async () =>
      root.render(
        <TooltipProvider>
          <TeamDetailPanel {...props} membersLoading membersRefreshing membersComplete={false} />
        </TooltipProvider>,
      ),
    )
    expect(host.querySelector('input[aria-label="teams.selectMember"]')).toBe(checkbox)
    expect(checkbox.checked).toBe(true)
    await act(async () =>
      root.render(
        <TooltipProvider>
          <TeamDetailPanel {...props} membersError="offline" membersComplete={false} />
        </TooltipProvider>,
      ),
    )
    expect(host.querySelector('input[aria-label="teams.selectMember"]')).toBe(checkbox)
    expect(checkbox.checked).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
