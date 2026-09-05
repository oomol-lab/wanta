// @vitest-environment happy-dom
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { DiscoverSkillsPane } from "./DiscoverSkillsPane.tsx"

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
