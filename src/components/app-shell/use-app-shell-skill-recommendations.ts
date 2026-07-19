import type { ChatTeamSkillContext } from "../../../electron/chat/common.ts"
import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { SkillInventory } from "../../../electron/skills/common.ts"
import type { AppShellRoute } from "./app-shell-types.ts"
import type { UseTeamSkills } from "@/hooks/useTeamSkills"

import * as React from "react"
import {
  EMPTY_CONNECTION_PROVIDERS,
  getUnlinkedProviderSkillRecommendations,
  shouldShowRecommendedSkillEntry,
} from "./app-shell-model.ts"
import { useProviderSkillRecommendations } from "@/hooks/useProviderSkillRecommendations"
import { getInstallableTeamSkills } from "@/routes/Skills/skill-route-model"

export function useAppShellSkillRecommendations({
  activeProviders,
  inventory,
  teamSkills,
  route,
}: {
  activeProviders: ConnectionProviderSummary[]
  inventory: SkillInventory | null | undefined
  teamSkills: UseTeamSkills
  route: AppShellRoute
}) {
  const groupById = React.useMemo(
    () => new Map((inventory?.groups ?? []).map((group) => [group.id, group])),
    [inventory?.groups],
  )
  const installableTeamSkills = React.useMemo(() => {
    if (!teamSkills.teamId || !inventory) {
      return []
    }
    return getInstallableTeamSkills(groupById, teamSkills.skills)
  }, [groupById, inventory, teamSkills.teamId, teamSkills.skills])
  const recommendationsEnabled = route === "chat" || route === "skills" || route === "teams"
  const providerRecommendations = useProviderSkillRecommendations({
    groupById,
    providers: teamSkills.teamId && recommendationsEnabled ? activeProviders : EMPTY_CONNECTION_PROVIDERS,
  })
  const installableProviderRecommendations = React.useMemo(
    () => getUnlinkedProviderSkillRecommendations(teamSkills.skills, providerRecommendations.installable),
    [teamSkills.skills, providerRecommendations.installable],
  )
  const showcaseItems = React.useMemo<ChatTeamSkillContext[]>(() => {
    const teamShowcaseSkills = installableTeamSkills.length > 0 ? installableTeamSkills : teamSkills.skills
    const teamItems = teamShowcaseSkills.map((skill) => ({
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
    return [...teamItems, ...providerItems]
  }, [installableTeamSkills, installableProviderRecommendations, teamSkills.skills])

  return {
    entryVisible: shouldShowRecommendedSkillEntry({
      teamId: teamSkills.teamId,
      teamSkillCount: teamSkills.skills.length,
      providerRecommendationCount: installableProviderRecommendations.length,
    }),
    pendingInstallCount: inventory
      ? installableTeamSkills.length + installableProviderRecommendations.length
      : undefined,
    providerRecommendations,
    showcaseItems,
  }
}
