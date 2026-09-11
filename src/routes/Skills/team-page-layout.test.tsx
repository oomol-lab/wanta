import type { ProviderSkillRecommendation } from "./provider-skill-recommendations.ts"
// @vitest-environment happy-dom
import type { UseTeamSkills } from "@/hooks/useTeamSkills"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { TeamManagementRoute } from "./TeamManagement.tsx"
import { TeamSkillManagePanel } from "./TeamSkillManagePanel.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

const { resource, service, details, translate } = vi.hoisted(() => ({
  resource: { data: { groups: [], skills: [] }, isInitialLoading: false, invalidate: vi.fn(), refresh: vi.fn() },
  service: { invoke: vi.fn() },
  details: {
    membersState: { data: [{ user_id: "owner", role: "creator" }], status: "ready", error: null },
    summariesState: { data: {} },
    refresh: vi.fn(),
    reload: vi.fn(),
  },
  translate: (key: string) => key,
}))
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: translate, locale: "en" }) }))
vi.mock("@/components/AppContext", () => ({ useSkillService: () => service }))
vi.mock("@/components/AppDataHooks", () => ({
  useAuthStateResource: () => ({ data: { status: "authenticated", account: { id: "owner", name: "Owner" } } }),
  useSkillInventoryResource: () => resource,
  useSkillVersionReportResource: () => resource,
}))
vi.mock("./use-team-details.ts", () => ({ useTeamDetails: () => details }))
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)

const team = { id: "team-a", name: "Team A", creator_user_id: "owner", avatar: "" }
function workspace(canManage = true): UseTeamWorkspace {
  return {
    activeWorkspace: { team, teamId: team.id, canManage, role: canManage ? "creator" : "member" },
    connectionWorkspace: null,
    error: null,
    loading: false,
    hasLoaded: true,
    teams: [team],
    teamAvatarPreviewUrls: {},
    getTeamCanManage: () => canManage,
    getTeamRole: () => (canManage ? "creator" : "member"),
    clearTeamAvatarPreview: vi.fn(),
    refresh: vi.fn(),
    selectTeam: vi.fn(),
    syncOverview: vi.fn(),
    upsertTeam: vi.fn(),
  }
}
function skills(canManage = true): UseTeamSkills {
  return {
    teamId: team.id,
    teamName: team.name,
    canManage,
    apiEnabled: true,
    hasLoaded: true,
    loading: false,
    error: null,
    skills: [],
    chatContextSkills: [],
    addSkill: vi.fn(),
    removePackage: vi.fn(),
    refresh: vi.fn(),
  }
}
const suggestion: ProviderSkillRecommendation = {
  packageName: "oo-suggested",
  skillId: "suggested",
  providerDisplayName: "Suggested service",
  service: "suggested",
  installState: "installable",
  package: {
    id: "suggested",
    name: "oo-suggested",
    displayName: "Suggested skill",
    version: "1.0.0",
    visibility: "public",
    maintainers: [],
    isTemplate: false,
    skills: [{ name: "suggested", title: "Suggested skill" }],
  },
}
const recommendations = {
  error: null,
  installable: [suggestion],
  isLoading: false,
  pendingCount: 0,
  recommendations: [suggestion],
  resolvedCount: 1,
  totalCount: 1,
}
function paneProps(teamSkills = skills()): React.ComponentProps<typeof TeamSkillManagePanel> {
  return {
    busyAction: null,
    groupById: new Map(),
    teamSkills,
    providerRecommendations: [suggestion],
    onAddRecommendation: vi.fn(),
    onAddRecommendationBatch: vi.fn(),
    onAddMarketPackage: vi.fn(),
    onInstallRuntimeSkill: vi.fn(),
    onInstallRuntimeSkills: vi.fn(),
    onOpenManagedSkill: vi.fn(),
    onOpenPackageDetail: vi.fn(),
  }
}
const containers: HTMLElement[] = []
async function mount(element: React.ReactNode) {
  const container = document.createElement("div")
  document.body.append(container)
  containers.push(container)
  const root = createRoot(container)
  const render = (node: React.ReactNode) => act(async () => root.render(<TooltipProvider>{node}</TooltipProvider>))
  await render(element)
  return { container, render, unmount: () => act(async () => root.unmount()) }
}
async function clickText(container: ParentNode, text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === text && !b.closest("[hidden]"),
  )
  expect(button, text).toBeDefined()
  await act(async () => {
    button!.focus()
    if (button!.getAttribute("role") === "tab")
      button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    else button!.click()
  })
}
afterEach(() => {
  containers.splice(0).forEach((container) => container.remove())
  vi.clearAllMocks()
})

test("team settings and members stay inline, and member addition uses one focused dialog", async () => {
  const view = await mount(
    <TeamManagementRoute
      workspace={workspace()}
      teamSkills={skills()}
      providerSkillRecommendationsState={recommendations}
    />,
  )
  try {
    await clickText(view.container, "teams.settingsTab")
    expect(view.container.querySelector("#edit-team-name")).not.toBeNull()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    await clickText(view.container, "teams.membersTab")
    expect(view.container.textContent).toContain("teams.memberManagement")
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    await clickText(view.container, "teams.addMember")
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1)
    expect(document.activeElement?.id).toBe("team-member-search")
    await clickText(document, "common.cancel")
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(document.activeElement?.textContent).toBe("teams.addMember")
    expect(view.container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("teams.membersTab")
  } finally {
    await view.unmount()
  }
})

test("switching teams clears settings and member dialog; revoked management rights cannot leave a blank settings tab", async () => {
  const initialWorkspace = workspace()
  const view = await mount(
    <TeamManagementRoute
      workspace={initialWorkspace}
      teamSkills={skills()}
      providerSkillRecommendationsState={recommendations}
    />,
  )
  try {
    await clickText(view.container, "teams.settingsTab")
    await view.render(
      <TeamManagementRoute
        workspace={workspace(false)}
        teamSkills={skills(false)}
        providerSkillRecommendationsState={recommendations}
      />,
    )
    expect(view.container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("teams.membersTab")
    expect(view.container.textContent).not.toContain("teams.settingsTab")
    expect(view.container.textContent).not.toContain("teams.addMember")
    await view.render(
      <TeamManagementRoute
        workspace={initialWorkspace}
        teamSkills={skills()}
        providerSkillRecommendationsState={recommendations}
      />,
    )
    await clickText(view.container, "teams.addMember")
    const nextTeam = { ...team, id: "team-b", name: "Team B" }
    await view.render(
      <TeamManagementRoute
        workspace={{
          ...initialWorkspace,
          teams: [nextTeam],
          activeWorkspace: { ...initialWorkspace.activeWorkspace, team: nextTeam, teamId: nextTeam.id },
        }}
        teamSkills={{ ...skills(), teamId: nextTeam.id }}
        providerSkillRecommendationsState={recommendations}
      />,
    )
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(view.container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("teams.skillGuideTitle")
    expect(view.container.textContent).toContain("Team B")
  } finally {
    await view.unmount()
  }
})

test("system recommendations only appear during addition, which links without installing", async () => {
  const props = paneProps()
  const view = await mount(<TeamSkillManagePanel {...props} />)
  try {
    expect(view.container.textContent).toContain("teams.skillGuideEmptyTitle")
    expect(view.container.textContent).not.toContain("Suggested skill")
    await clickText(view.container, "teams.addSkillsTitle")
    expect(view.container.textContent).toContain("Suggested skill")
    expect(view.container.textContent).not.toContain("teams.skillManageInstallRuntime")
    await clickText(view.container, "teams.skillManageAddOnly")
    expect(props.onAddRecommendation).toHaveBeenCalledWith(suggestion, { installRuntime: false })
    expect(props.onInstallRuntimeSkill).not.toHaveBeenCalled()
    await clickText(view.container, "teams.backToSkills")
    expect(view.container.textContent).not.toContain("Suggested skill")
    await view.render(<TeamSkillManagePanel {...props} teamSkills={skills(false)} />)
    expect(view.container.textContent).not.toContain("teams.addSkillsTitle")
  } finally {
    await view.unmount()
  }
})

test("install missing includes only configured skills and waits for local inventory", async () => {
  const configured: UseTeamSkills = {
    ...skills(false),
    skills: [
      {
        id: "configured",
        packageName: "oo-configured",
        skillName: "configured",
        displayName: "Configured skill",
        enabled: true,
        order: 0,
        visibility: "public",
        version: "1.0.0",
        versionPolicy: "pinned",
      },
    ],
  }
  const props = paneProps(configured)
  const view = await mount(<TeamSkillManagePanel {...props} runtimeInventoryLoading />)
  try {
    expect(view.container.textContent).not.toContain("teams.skillManageInstallMissingAll")
    await view.render(<TeamSkillManagePanel {...props} />)
    expect(view.container.textContent).toContain("Configured skill")
    expect(view.container.textContent).not.toContain("Suggested skill")
    await clickText(view.container, "teams.skillManageInstallMissingAll")
    expect(props.onInstallRuntimeSkills).toHaveBeenCalledExactlyOnceWith([
      { packageName: "oo-configured", skillName: "configured" },
    ])
  } finally {
    await view.unmount()
  }
})

test("catalog details stay inline and return to the skill selection flow", async () => {
  const view = await mount(
    <TeamManagementRoute
      workspace={workspace()}
      teamSkills={skills()}
      providerSkillRecommendationsState={recommendations}
    />,
  )
  try {
    await clickText(view.container, "teams.addSkillsTitle")
    await clickText(view.container, "Suggested skill")
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(view.container.querySelector("aside")?.textContent).toContain("oo-suggested")
    await clickText(view.container, "teams.backToSkills")
    expect(view.container.querySelector("aside")).toBeNull()
    expect(document.activeElement?.textContent).toBe("Suggested skill")
    expect(view.container.textContent).toContain("teams.skillManageRecommended")
  } finally {
    await view.unmount()
  }
})

test("ordinary members can discover and install recommendations without changing the shared list", async () => {
  const props = paneProps(skills(false))
  const view = await mount(<TeamSkillManagePanel {...props} />)
  try {
    expect(view.container.querySelector('[data-slot="empty-content"]')?.textContent).toContain(
      "teams.browseSkillsTitle",
    )
    await clickText(view.container, "teams.browseSkillsTitle")
    expect(view.container.textContent).toContain("Suggested skill")
    expect(view.container.textContent).toContain("teams.skillManageMarket")
    expect(view.container.textContent).not.toContain("teams.skillManageAddOnly")
    await clickText(view.container, "teams.skillManageInstallRuntime")
    expect(props.onInstallRuntimeSkill).toHaveBeenCalledExactlyOnceWith({
      packageName: suggestion.packageName,
      skillName: suggestion.skillId,
    })
    expect(props.onAddRecommendation).not.toHaveBeenCalled()
    expect(props.teamSkills.addSkill).not.toHaveBeenCalled()
    await clickText(view.container, "teams.backToSkills")
    expect(view.container.textContent).toContain("teams.skillGuideEmptyTitle")
  } finally {
    await view.unmount()
  }
})

test("revoking management rights keeps discovery available and switches to local-only actions", async () => {
  const props = paneProps()
  const view = await mount(<TeamSkillManagePanel {...props} />)
  try {
    await clickText(view.container, "teams.addSkillsTitle")
    await view.render(<TeamSkillManagePanel {...props} teamSkills={skills(false)} />)
    expect(view.container.textContent).toContain("Suggested skill")
    expect(view.container.textContent).not.toContain("teams.skillManageAddOnly")
    expect(view.container.textContent).toContain("teams.skillManageInstallRuntime")
    const installed = { ...suggestion, installState: "installed" as const }
    await view.render(
      <TeamSkillManagePanel {...props} teamSkills={skills(false)} providerRecommendations={[installed]} />,
    )
    await clickText(view.container, "skills.installedManage")
    expect(props.onOpenManagedSkill).toHaveBeenCalledExactlyOnceWith(suggestion.skillId)
    expect(props.onAddRecommendation).not.toHaveBeenCalled()
  } finally {
    await view.unmount()
  }
})
