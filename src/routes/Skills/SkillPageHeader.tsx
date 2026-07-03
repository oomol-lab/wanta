import type { DiscoverSkillFilter, InstalledSkillFilter, SkillPageTab } from "./skill-route-model.ts"

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
  onDiscoveryFilterChange: (filter: DiscoverSkillFilter) => void
  onDiscoveryQueryChange: (value: string) => void
  onInstalledFilterChange: (filter: InstalledSkillFilter) => void
  onInstalledQueryChange: (value: string) => void
  onOrganizationFilterChange: (filter: OrganizationSkillFilter) => void
  onOrganizationQueryChange: (value: string) => void
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
  onDiscoveryFilterChange,
  onDiscoveryQueryChange,
  onInstalledFilterChange,
  onInstalledQueryChange,
  onOrganizationFilterChange,
  onOrganizationQueryChange,
  onTabChange,
}: SkillPageHeaderProps) {
  const { t } = useAppI18n()
  const isDiscoverTab = activeTab === "discover"
  const isOrganizationTab = activeTab === "organization"
  const searchValue = isDiscoverTab ? discoveryQuery : isOrganizationTab ? organizationQuery : installedQuery
  const searchPlaceholder = isDiscoverTab
    ? "skills.discoverSearch"
    : isOrganizationTab
      ? "skills.organizationSearch"
      : "skills.installedSearch"
  const filterValue = isDiscoverTab ? discoveryFilter : isOrganizationTab ? organizationFilter : installedFilter
  const filterOptions = isDiscoverTab
    ? [
        { label: t("skills.discoverFilter.all"), value: "all" },
        { label: t("skills.discoverFilter.mine"), value: "mine" },
      ]
    : isOrganizationTab
      ? [
          { label: t("skills.organizationFilter.all"), value: "all" },
          { label: t("organizations.skillManageRecommended"), value: "recommended" },
          { label: t("organizations.skillManageConfigured"), value: "configured" },
        ]
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
        onTabChange={onTabChange}
      />
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <SearchField
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

            if (!isDiscoverTab && !isOrganizationTab && isInstalledSkillFilter(value)) {
              onInstalledFilterChange(value)
            }
          }}
        />
      </div>
    </header>
  )
}

function SkillTabList({
  activeTab,
  organizationTabAvailable,
  onTabChange,
}: {
  activeTab: SkillPageTab
  organizationTabAvailable: boolean
  onTabChange: (tab: SkillPageTab) => void
}) {
  const { t } = useAppI18n()
  const tabs: Array<{ label: string; value: SkillPageTab }> = [
    { label: t("skills.tab.discover"), value: "discover" },
    { label: t("skills.tab.installed"), value: "installed" },
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
        if (value === "organization" || value === "discover" || value === "installed") {
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
