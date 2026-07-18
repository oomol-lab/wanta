import type { ChatOrganizationSkillContext } from "../../../electron/chat/common.ts"
import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { SkillInventory } from "../../../electron/skills/common.ts"
import type { AppShellRoute } from "./app-shell-types.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"

import * as React from "react"
import {
  EMPTY_CONNECTION_PROVIDERS,
  getUnlinkedProviderSkillRecommendations,
  shouldShowRecommendedSkillEntry,
} from "./app-shell-model.ts"
import { useProviderSkillRecommendations } from "@/hooks/useProviderSkillRecommendations"
import { getInstallableOrganizationSkills } from "@/routes/Skills/skill-route-model"

export function useAppShellSkillRecommendations({
  activeProviders,
  inventory,
  organizationSkills,
  route,
}: {
  activeProviders: ConnectionProviderSummary[]
  inventory: SkillInventory | null | undefined
  organizationSkills: UseOrganizationSkills
  route: AppShellRoute
}) {
  const groupById = React.useMemo(
    () => new Map((inventory?.groups ?? []).map((group) => [group.id, group])),
    [inventory?.groups],
  )
  const installableOrganizationSkills = React.useMemo(() => {
    if (!organizationSkills.organizationId || !inventory) {
      return []
    }
    return getInstallableOrganizationSkills(groupById, organizationSkills.skills)
  }, [groupById, inventory, organizationSkills.organizationId, organizationSkills.skills])
  const recommendationsEnabled = route === "chat" || route === "skills" || route === "organizations"
  const providerRecommendations = useProviderSkillRecommendations({
    groupById,
    providers:
      organizationSkills.organizationId && recommendationsEnabled ? activeProviders : EMPTY_CONNECTION_PROVIDERS,
  })
  const installableProviderRecommendations = React.useMemo(
    () => getUnlinkedProviderSkillRecommendations(organizationSkills.skills, providerRecommendations.installable),
    [organizationSkills.skills, providerRecommendations.installable],
  )
  const showcaseItems = React.useMemo<ChatOrganizationSkillContext[]>(() => {
    const organizationShowcaseSkills =
      installableOrganizationSkills.length > 0 ? installableOrganizationSkills : organizationSkills.skills
    const organizationItems = organizationShowcaseSkills.map((skill) => ({
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.icon ? { icon: skill.icon } : {}),
      id: skill.id,
      name: skill.displayName || skill.skillName,
      packageName: skill.packageName,
      skillName: skill.skillName,
      version: skill.version,
    }))
    const providerItems = installableProviderRecommendations.map((recommendation) => {
      const recommendedSkill = recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)
      return {
        ...(recommendation.package.description ? { description: recommendation.package.description } : {}),
        ...(recommendation.providerIconUrl ? { icon: recommendation.providerIconUrl } : {}),
        id: `provider:${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`,
        name: recommendation.package.displayName || recommendedSkill?.title || recommendation.skillId,
        packageName: recommendation.packageName,
        skillName: recommendation.skillId,
        version: recommendation.package.version,
      }
    })
    return [...organizationItems, ...providerItems]
  }, [installableOrganizationSkills, installableProviderRecommendations, organizationSkills.skills])

  return {
    entryVisible: shouldShowRecommendedSkillEntry({
      organizationId: organizationSkills.organizationId,
      organizationSkillCount: organizationSkills.skills.length,
      providerRecommendationCount: installableProviderRecommendations.length,
    }),
    pendingInstallCount: inventory
      ? installableOrganizationSkills.length + installableProviderRecommendations.length
      : undefined,
    providerRecommendations,
    showcaseItems,
  }
}
