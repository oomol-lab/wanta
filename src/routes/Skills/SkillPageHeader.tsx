import type { DiscoverSkillFilter, InstalledSkillFilter, SkillPageTab } from "./skill-route-model.ts"
import type { ReactNode } from "react"

import { isDiscoverSkillFilter, isInstalledSkillFilter } from "./skill-route-model.ts"
import { AppIcons } from "@/components/AppIcons"
import { SearchField } from "@/components/SearchField"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppI18n } from "@/i18n"

export type OrganizationSkillFilter = "all" | "recommended" | "configured"

function isOrganizationSkillFilter(value: string): value is OrganizationSkillFilter {
  return value === "all" || value === "recommended" || value === "configured"
}

interface SkillPageHeaderProps {
  activeTab: SkillPageTab
  discoveryFilter: DiscoverSkillFilter
  discoveryQuery: string
  installedFilter: InstalledSkillFilter
  installedQuery: string
  organizationFilter: OrganizationSkillFilter
  organizationQuery: string
  organizationTabAvailable: boolean
  organizationAction?: ReactNode
  recommendedAction?: ReactNode
  recommendedQuery: string
  recommendedTabAvailable: boolean
  onDiscoveryFilterChange: (filter: DiscoverSkillFilter) => void
  onDiscoveryQueryChange: (value: string) => void
  onInstalledFilterChange: (filter: InstalledSkillFilter) => void
  onInstalledQueryChange: (value: string) => void
  onOrganizationFilterChange: (filter: OrganizationSkillFilter) => void
  onOrganizationQueryChange: (value: string) => void
  onRecommendedQueryChange: (value: string) => void
  onTabChange: (tab: SkillPageTab) => void
}

export function SkillPageHeader({
  activeTab,
  discoveryFilter,
  discoveryQuery,
  installedFilter,
  installedQuery,
  organizationFilter,
  organizationQuery,
  organizationTabAvailable,
  organizationAction,
  recommendedAction,
  recommendedQuery,
  recommendedTabAvailable,
  onDiscoveryFilterChange,
  onDiscoveryQueryChange,
  onInstalledFilterChange,
  onInstalledQueryChange,
  onOrganizationFilterChange,
  onOrganizationQueryChange,
  onRecommendedQueryChange,
  onTabChange,
}: SkillPageHeaderProps) {
  const { t } = useAppI18n()
  const isDiscoverTab = activeTab === "discover"
  const isOrganizationTab = activeTab === "organization"
  const isRecommendedTab = activeTab === "recommended"
  const searchValue = isDiscoverTab
    ? discoveryQuery
    : isOrganizationTab
      ? organizationQuery
      : isRecommendedTab
        ? recommendedQuery
        : installedQuery
  const searchPlaceholder = isDiscoverTab
    ? "skills.discoverSearch"
    : isOrganizationTab
      ? "skills.organizationSearch"
      : isRecommendedTab
        ? "skills.personalRecommendationsSearch"
        : "skills.installedSearch"
  const filterValue = isDiscoverTab
    ? discoveryFilter
    : isOrganizationTab
      ? organizationFilter
      : isRecommendedTab
        ? "all"
        : installedFilter
  const filterOptions = isDiscoverTab
    ? [
        { label: t("skills.discoverFilter.all"), value: "all" },
        { label: t("skills.discoverFilter.mine"), value: "mine" },
      ]
    : isOrganizationTab
      ? [
          { label: t("organizations.skillManageSourceAll"), value: "all" },
          { label: t("organizations.skillManageRecommended"), value: "recommended" },
          { label: t("organizations.skillManageConfigured"), value: "configured" },
        ]
      : isRecommendedTab
        ? [{ label: t("skills.installedFilter.all"), value: "all" }]
        : [
            { label: t("skills.installedFilter.all"), value: "all" },
            { label: t("skills.installedFilter.wanta"), value: "wanta" },
            { label: t("skills.installedFilter.codex"), value: "codex" },
            { label: t("skills.installedFilter.claudeCode"), value: "claude-code" },
            { label: t("skills.installedFilter.updates"), value: "updates" },
            { label: t("skills.installedFilter.local"), value: "local" },
          ]

  return (
    <header className="oo-border-divider flex min-h-12 items-center gap-2 border-b px-3 py-2">
      <SkillTabList
        activeTab={activeTab}
        organizationTabAvailable={organizationTabAvailable}
        recommendedTabAvailable={recommendedTabAvailable}
        onTabChange={onTabChange}
      />
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
            if (isOrganizationTab) {
              onOrganizationQueryChange(value)
              return
            }
            if (isRecommendedTab) {
              onRecommendedQueryChange(value)
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

            if (isOrganizationTab && isOrganizationSkillFilter(value)) {
              onOrganizationFilterChange(value)
              return
            }

            if (!isDiscoverTab && !isOrganizationTab && !isRecommendedTab && isInstalledSkillFilter(value)) {
              onInstalledFilterChange(value)
            }
          }}
        />
        {isOrganizationTab && organizationAction ? <div className="shrink-0">{organizationAction}</div> : null}
        {isRecommendedTab && recommendedAction ? <div className="shrink-0">{recommendedAction}</div> : null}
      </div>
    </header>
  )
}

function SkillTabList({
  activeTab,
  organizationTabAvailable,
  recommendedTabAvailable,
  onTabChange,
}: {
  activeTab: SkillPageTab
  organizationTabAvailable: boolean
  recommendedTabAvailable: boolean
  onTabChange: (tab: SkillPageTab) => void
}) {
  const { t } = useAppI18n()
  const tabs: Array<{ label: string; value: SkillPageTab }> = [
    { label: t("skills.tab.discover"), value: "discover" },
    { label: t("skills.tab.installed"), value: "installed" },
    ...(recommendedTabAvailable ? [{ label: t("skills.tab.recommended"), value: "recommended" as SkillPageTab }] : []),
    ...(organizationTabAvailable
      ? [{ label: t("skills.tab.organization"), value: "organization" as SkillPageTab }]
      : []),
  ]

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="shrink-0"
      value={activeTab}
      onValueChange={(value) => {
        if (value === "organization" || value === "recommended" || value === "discover" || value === "installed") {
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
