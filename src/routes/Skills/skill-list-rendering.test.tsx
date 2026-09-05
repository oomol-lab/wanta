// @vitest-environment happy-dom
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"
import { TeamSkillsPane } from "./TeamSkillsPane.tsx"

const { rowRender, translate } = vi.hoisted(() => ({
  rowRender: vi.fn(() => null),
  translate: (key: string) => key,
}))
vi.mock("./SkillListRow.tsx", () => ({ SkillListRow: rowRender }))
vi.mock("./PublicSkillPackageSheet.tsx", () => ({ PublicSkillPackageSheet: () => null }))
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: translate, locale: "en" }) }))

test("a 500-package list skips unchanged rows and renders only the affected install or selection row", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const root = createRoot(document.createElement("div"))
  const packages: PublicSkillPackage[] = Array.from({ length: 500 }, (_, index) => ({
    id: `demo-${index}@1.0.0`,
    name: `demo-${index}`,
    displayName: `Demo ${index}`,
    skills: [{ name: `skill-${index}`, title: `Skill ${index}` }],
    version: "1.0.0",
    isTemplate: false,
    maintainers: [],
    visibility: "public",
  }))
  const props = {
    error: null,
    filter: "all" as const,
    groupById: new Map(),
    installingKey: null as string | null,
    isLoading: false,
    isLoadingMore: false,
    isSignedIn: true,
    canInstall: true,
    locale: "en",
    next: null,
    packages,
    providerRecommendations: [],
    selectedPackage: undefined as PublicSkillPackage | undefined,
    onClosePackage: vi.fn(),
    onInstall: vi.fn(),
    onLoadMore: vi.fn(),
    onOpenManagedSkill: vi.fn(),
    onRetry: vi.fn(),
    onSelectPackage: vi.fn(),
  }
  try {
    await act(async () => root.render(<DiscoverSkillsPane {...props} />))
    expect(rowRender).toHaveBeenCalledTimes(500)
    rowRender.mockClear()
    await act(async () => root.render(<DiscoverSkillsPane {...props} />))
    expect(rowRender).not.toHaveBeenCalled()
    await act(async () => root.render(<DiscoverSkillsPane {...props} installingKey="demo-12@1.0.0:skill-12" />))
    expect(rowRender).toHaveBeenCalledTimes(1)
    rowRender.mockClear()
    await act(async () =>
      root.render(
        <DiscoverSkillsPane {...props} installingKey="demo-12@1.0.0:skill-12" selectedPackage={packages[20]} />,
      ),
    )
    expect(rowRender).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})

test("configured team rows ignore unrelated actions and recommendation updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  rowRender.mockClear()
  const root = createRoot(document.createElement("div"))
  type Props = React.ComponentProps<typeof TeamSkillsPane>
  const configuredSkills: Props["teamSkills"]["skills"] = Array.from({ length: 100 }, (_, index) => ({
    id: `configured-${index}`,
    displayName: `Configured ${index}`,
    enabled: true,
    order: index,
    packageName: `configured-${index}`,
    skillName: `configured-${index}`,
    version: "1.0.0",
    versionPolicy: "pinned",
    visibility: "public",
  }))
  const recommendation: Props["providerRecommendations"][number] = {
    providerDisplayName: "Demo",
    service: "demo",
    packageName: "oo-demo",
    skillId: "demo",
    installState: "installable",
    package: {
      id: "oo-demo@1.0.0",
      name: "oo-demo",
      displayName: "Demo",
      skills: [{ name: "demo", title: "Demo" }],
      version: "1.0.0",
      isTemplate: false,
      maintainers: [],
      visibility: "public",
    },
  }
  const props: Props = {
    busyAction: null,
    groupById: new Map(),
    teamFilter: "all",
    teamQuery: "",
    teamSkills: {
      skills: configuredSkills,
      teamId: "team",
      teamName: "Team",
      canManage: true,
      apiEnabled: true,
      loading: false,
      hasLoaded: true,
      error: null,
      chatContextSkills: [],
      addSkill: vi.fn(),
      removePackage: vi.fn(),
      refresh: vi.fn(),
    },
    workspace: { activeWorkspace: { teamId: "team", canManage: true } } as Props["workspace"],
    providerRecommendations: [recommendation],
    providerRecommendationsLoading: false,
    providerRecommendationsPendingCount: 0,
    providerRecommendationsTotalCount: 1,
    onAddRecommendation: vi.fn(),
    onInstallRuntimeSkill: vi.fn(),
    onOpenManagedSkill: vi.fn(),
  }
  try {
    await act(async () => root.render(<TeamSkillsPane {...props} />))
    expect(rowRender).toHaveBeenCalledTimes(101)
    rowRender.mockClear()
    await act(async () => root.render(<TeamSkillsPane {...props} busyAction="addSkill:other:other" />))
    expect(rowRender).toHaveBeenCalledTimes(1)
    rowRender.mockClear()
    const updated = [{ ...recommendation, package: { ...recommendation.package, displayName: "Updated" } }]
    await act(async () =>
      root.render(<TeamSkillsPane {...props} busyAction="addSkill:other:other" providerRecommendations={updated} />),
    )
    expect(rowRender).toHaveBeenCalledTimes(1)
    rowRender.mockClear()
    await act(async () =>
      root.render(
        <TeamSkillsPane
          {...props}
          busyAction="installSkill:configured-5:configured-5"
          providerRecommendations={updated}
        />,
      ),
    )
    expect(rowRender).toHaveBeenCalledTimes(2)
    rowRender.mockClear()
    await act(async () =>
      root.render(<TeamSkillsPane {...props} busyAction="installSkillBatch" providerRecommendations={updated} />),
    )
    expect(rowRender).toHaveBeenCalledTimes(101)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
