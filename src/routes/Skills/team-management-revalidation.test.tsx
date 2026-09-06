import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { TeamManagementRoute } from "./TeamManagement.tsx"
import { useTeamSkillActions } from "./use-team-skill-actions.ts"
import { useTeamSkills } from "@/hooks/useTeamSkills"

const { empty, details, resource, service, translate } = vi.hoisted(() => ({
  empty: () => null,
  translate: (key: string) => key,
  details: {
    membersState: { data: [], status: "ready", error: null },
    summariesState: { data: {} },
    refresh: vi.fn(),
    reload: vi.fn(),
  },
  resource: { data: { groups: [], skills: [] }, invalidate: vi.fn(), refresh: vi.fn() },
  service: { invoke: vi.fn() },
}))
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: translate, locale: "en" }) }))
vi.mock("@/components/AppContext", () => ({ useSkillService: () => service }))
vi.mock("@/components/AppDataHooks", () => ({
  useAuthStateResource: () => ({ data: { status: "authenticated", account: { id: "revalidate", name: "Test" } } }),
  useSkillInventoryResource: () => resource,
  useSkillVersionReportResource: () => resource,
}))
vi.mock("./use-team-details.ts", () => ({ useTeamDetails: () => details }))
vi.mock("./TeamManagementPanels.tsx", () => ({
  EmptyTeamsState: empty,
  TeamManagementSkeleton: empty,
  TeamSkillGuidePanel: empty,
  TeamSwitcherPanel: empty,
}))
vi.mock("./TeamMembersPanel.tsx", () => ({
  AddMemberDialog: empty,
  CreateTeamDialog: empty,
  ErrorBlock: empty,
  TeamDetailPanel: empty,
  Panel: empty,
  TeamProfileSettingsPanel: empty,
}))
vi.mock("./TeamSettingsSheet.tsx", () => ({ TeamSettingsSheet: empty }))
vi.mock("@/components/DeleteSkillConfirmDialog", () => ({ DeleteSkillConfirmDialog: empty }))

test("team page entry and focus revalidate expired skills, preserve cache dedup and remove listeners on exit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const now = Date.now()
  const clock = vi.spyOn(Date, "now").mockReturnValue(now)
  const fetchMock = vi.fn(async () => Response.json({ data: [] }))
  vi.stubGlobal("fetch", fetchMock)
  const root = createRoot(document.createElement("div"))
  const team = { id: "revalidate-team", name: "Revalidation", creator_user_id: "revalidate", avatar: "" }
  const workspace: UseTeamWorkspace = {
    activeWorkspace: { team, teamId: team.id, canManage: true, role: "creator" },
    connectionWorkspace: null,
    error: null,
    loading: false,
    hasLoaded: true,
    teams: [team],
    teamAvatarPreviewUrls: {},
    getTeamCanManage: () => true,
    getTeamRole: () => "creator",
    clearTeamAvatarPreview: vi.fn(),
    refresh: vi.fn(),
    selectTeam: vi.fn(),
    syncOverview: vi.fn(),
    upsertTeam: vi.fn(),
  }
  const recommendations = {
    error: null,
    installable: [],
    isLoading: false,
    pendingCount: 0,
    recommendations: [],
    resolvedCount: 0,
    totalCount: 0,
  }
  function Shell({ visible }: { visible: boolean }) {
    const teamSkills = useTeamSkills(workspace.activeWorkspace, "revalidate")
    return visible ? (
      <TeamManagementRoute
        teamSkills={teamSkills}
        workspace={workspace}
        providerSkillRecommendationsState={recommendations}
      />
    ) : null
  }
  try {
    await act(async () => root.render(<Shell visible />))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => window.dispatchEvent(new Event("focus")))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(now + 31_000)
    await act(async () => window.dispatchEvent(new Event("focus")))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => root.render(<Shell visible={false} />))
    clock.mockReturnValue(now + 62_000)
    await act(async () => window.dispatchEvent(new Event("focus")))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => root.render(<Shell visible />))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  } finally {
    await act(async () => root.unmount())
    clock.mockRestore()
    vi.unstubAllGlobals()
  }
})

test("team action callbacks remain stable when only the workspace view object changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const root = createRoot(document.createElement("div"))
  const skills: UseTeamSkills = {
    addSkill: vi.fn(),
    removePackage: vi.fn(),
    refresh: vi.fn(),
    teamId: "stable-actions",
    teamName: "Stable",
    skills: [],
    chatContextSkills: [],
    apiEnabled: true,
    canManage: true,
    hasLoaded: true,
    loading: false,
    error: null,
  }
  let actions!: ReturnType<typeof useTeamSkillActions>
  function Probe({ view }: { view: UseTeamSkills }) {
    const [, setBusyAction] = React.useState<import("./team-management-model.ts").BusyAction | null>(null)
    actions = useTeamSkillActions({ busyAction: null, teamSkills: view, setBusyAction })
    return null
  }
  try {
    await act(async () => root.render(<Probe view={skills} />))
    const previous = actions
    await act(async () => root.render(<Probe view={{ ...skills }} />))
    expect(actions.addTeamSkillFromRecommendation).toBe(previous.addTeamSkillFromRecommendation)
    expect(actions.addTeamSkillFromPackage).toBe(previous.addTeamSkillFromPackage)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
