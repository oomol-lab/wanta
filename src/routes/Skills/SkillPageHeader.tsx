import type { DiscoverSkillFilter, InstalledSkillFilter, SkillPageTab } from "./skill-route-model.ts"
import type { ReactNode } from "react"

import { isDiscoverSkillFilter, isInstalledSkillFilter } from "./skill-route-model.ts"
import { AppIcons } from "@/components/AppIcons"
import { SearchField } from "@/components/SearchField"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppI18n } from "@/i18n"

export type TeamSkillFilter = "all" | "recommended" | "configured"

function isTeamSkillFilter(value: string): value is TeamSkillFilter {
  return value === "all" || value === "recommended" || value === "configured"
}

interface SkillPageHeaderProps {
  activeTab: SkillPageTab
  discoveryFilter: DiscoverSkillFilter
  discoveryQuery: string
  installedFilter: InstalledSkillFilter
  installedQuery: string
  teamFilter: TeamSkillFilter
  teamQuery: string
  teamTabAvailable: boolean
  publishedFilterAvailable: boolean
  registryUpdatesAvailable: boolean
  teamAction?: ReactNode
  onDiscoveryFilterChange: (filter: DiscoverSkillFilter) => void
  onDiscoveryQueryChange: (value: string) => void
  onInstalledFilterChange: (filter: InstalledSkillFilter) => void
  onInstalledQueryChange: (value: string) => void
  onTeamFilterChange: (filter: TeamSkillFilter) => void
  onTeamQueryChange: (value: string) => void
  onTabChange: (tab: SkillPageTab) => void
}

export function SkillPageHeader({
  activeTab,
  discoveryFilter,
  discoveryQuery,
  installedFilter,
  installedQuery,
  teamFilter,
  teamQuery,
  teamTabAvailable,
  publishedFilterAvailable,
  registryUpdatesAvailable,
  teamAction,
  onDiscoveryFilterChange,
  onDiscoveryQueryChange,
  onInstalledFilterChange,
  onInstalledQueryChange,
  onTeamFilterChange,
  onTeamQueryChange,
  onTabChange,
}: SkillPageHeaderProps) {
  const { t } = useAppI18n()
  const isDiscoverTab = activeTab === "discover"
  const isTeamTab = activeTab === "team"
  const searchValue = isDiscoverTab ? discoveryQuery : isTeamTab ? teamQuery : installedQuery
  const searchPlaceholder = isDiscoverTab
    ? "skills.discoverSearch"
    : isTeamTab
      ? "skills.teamSearch"
      : "skills.installedSearch"
  const filterValue = isDiscoverTab ? discoveryFilter : isTeamTab ? teamFilter : installedFilter
  const filterOptions = isDiscoverTab
    ? [
        { label: t("skills.discoverFilter.all"), value: "all" },
        ...(publishedFilterAvailable ? [{ label: t("skills.discoverFilter.mine"), value: "mine" }] : []),
      ]
    : isTeamTab
      ? [
          { label: t("teams.skillManageSourceAll"), value: "all" },
          { label: t("teams.skillManageRecommended"), value: "recommended" },
          { label: t("teams.skillManageConfigured"), value: "configured" },
        ]
      : [
          { label: t("skills.installedFilter.all"), value: "all" },
          { label: t("skills.installedFilter.wanta"), value: "wanta" },
          { label: t("skills.installedFilter.codex"), value: "codex" },
          { label: t("skills.installedFilter.claudeCode"), value: "claude-code" },
          ...(registryUpdatesAvailable ? [{ label: t("skills.installedFilter.updates"), value: "updates" }] : []),
          { label: t("skills.installedFilter.local"), value: "local" },
        ]

  return (
    <header className="oo-border-divider flex min-h-12 items-center border-b px-3 py-2">
      <div className="flex w-full min-w-0 items-center gap-2">
        <SkillTabList activeTab={activeTab} teamTabAvailable={teamTabAvailable} onTabChange={onTabChange} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SearchField
            className="flex-1"
            placeholder={t(searchPlaceholder)}
            value={searchValue}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (isDiscoverTab) {
                onDiscoveryQueryChange(value)
                return
              }
              if (isTeamTab) {
                onTeamQueryChange(value)
                return
              }
              onInstalledQueryChange(value)
            }}
          />
          <SkillFilterDropdown
            ariaLabel={t("skills.filter")}
            options={filterOptions}
            value={filterValue}
            onValueChange={(value) => {
              if (isDiscoverTab && isDiscoverSkillFilter(value)) {
                onDiscoveryFilterChange(value)
                return
              }

              if (isTeamTab && isTeamSkillFilter(value)) {
                onTeamFilterChange(value)
                return
              }

              if (!isDiscoverTab && !isTeamTab && isInstalledSkillFilter(value)) {
                onInstalledFilterChange(value)
              }
            }}
          />
          {isTeamTab && teamAction ? <div className="shrink-0">{teamAction}</div> : null}
        </div>
      </div>
    </header>
  )
}

function SkillTabList({
  activeTab,
  teamTabAvailable,
  onTabChange,
}: {
  activeTab: SkillPageTab
  teamTabAvailable: boolean
  onTabChange: (tab: SkillPageTab) => void
}) {
  const { t } = useAppI18n()
  const tabs: Array<{ label: string; value: SkillPageTab }> = [
    { label: t("skills.tab.discover"), value: "discover" },
    { label: t("skills.tab.installed"), value: "installed" },
    ...(teamTabAvailable ? [{ label: t("skills.tab.team"), value: "team" as SkillPageTab }] : []),
  ]

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="shrink-0"
      value={activeTab}
      onValueChange={(value) => {
        if (value === "team" || value === "discover" || value === "installed") {
          onTabChange(value)
        }
      }}
    >
      {tabs.map((tab) => (
        <ToggleGroupItem key={tab.value} value={tab.value}>
          {tab.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

interface SkillFilterDropdownProps {
  ariaLabel: string
  onValueChange: (value: string) => void
  options: { label: string; value: string }[]
  value: string
}

function SkillFilterDropdown({ ariaLabel, onValueChange, options, value }: SkillFilterDropdownProps) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-36 min-w-24 justify-between px-2"
          aria-label={ariaLabel}
        >
          <AppIcons.action.settings className="size-3.5" />
          <span className="min-w-0 truncate">{selectedOption?.label ?? value}</span>
          <AppIcons.status.disclosure className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44">
        {options.map((option) => {
          const selected = option.value === value

          return (
            <DropdownMenuItem
              key={option.value}
              className="min-w-0 justify-between gap-3"
              aria-checked={selected}
              onSelect={() => onValueChange(option.value)}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {selected ? <AppIcons.status.check className="size-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
