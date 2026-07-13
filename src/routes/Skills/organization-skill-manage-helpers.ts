import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { OrganizationSkillFilter } from "./SkillPageHeader.tsx"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { useAppI18n } from "@/i18n"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations.ts"
import type { ManagedSkillGroupById, OrganizationSkillRuntimeState } from "@/routes/Skills/skill-route-model.ts"

import {
  createOrganizationSkillPackageSet,
  organizationSkillIdentityKey,
  organizationSkillPackageKey,
  organizationSkillPackageLinked,
} from "./organization-management-model.ts"
import {
  canInstallPublicSkill,
  getOrganizationSkillRuntimeStatus,
  shouldOpenPublicSkillManagement,
} from "./skill-route-model.ts"

export function looksLikeSkillPackageName(query: string): boolean {
  const normalized = query.trim()
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(normalized) && normalized.length >= 3
}

export function mergeMarketPackages(
  packageInfo: PublicSkillPackage | null,
  packages: readonly PublicSkillPackage[],
): PublicSkillPackage[] {
  const items = packageInfo ? [packageInfo, ...packages] : [...packages]
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.name.trim().toLowerCase()
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function organizationSkillMatchesQuery(
  skill: UseOrganizationSkills["skills"][number],
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true
  }
  return [skill.displayName, skill.skillName, skill.packageName, skill.description ?? "", skill.version]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery))
}

export function providerRecommendationMatchesQuery(
  recommendation: ProviderSkillRecommendation,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true
  }
  const skillDescription =
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ?? ""
  return [
    recommendation.providerDisplayName,
    recommendation.package.displayName,
    recommendation.packageName,
    recommendation.skillId,
    recommendation.package.description ?? "",
    skillDescription,
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function providerRecommendationSkillDescription(
  recommendation: ProviderSkillRecommendation,
): string | undefined {
  return (
    recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)?.description ??
    recommendation.package.description
  )
}

export function canInstallProviderRecommendationRuntime(recommendation: ProviderSkillRecommendation): boolean {
  return canInstallPublicSkill(recommendation.installState)
}

export function canOpenManagedProviderRecommendation(recommendation: ProviderSkillRecommendation): boolean {
  return shouldOpenPublicSkillManagement(recommendation.installState)
}

export type OrganizationSkillRecommendationItem =
  | {
      id: string
      skill: UseOrganizationSkills["skills"][number]
      type: "configured"
    }
  | {
      id: string
      recommendation: ProviderSkillRecommendation
      type: "recommended"
    }

export function buildOrganizationSkillRecommendationItems({
  filter,
  normalizedQuery,
  providerRecommendations,
  skills,
}: {
  filter: OrganizationSkillFilter
  normalizedQuery: string
  providerRecommendations: readonly ProviderSkillRecommendation[]
  skills: UseOrganizationSkills["skills"]
}): OrganizationSkillRecommendationItem[] {
  const configuredPackageKeys = createOrganizationSkillPackageSet(skills)
  const configuredItems: OrganizationSkillRecommendationItem[] =
    filter === "recommended"
      ? []
      : skills
          .filter((skill) => organizationSkillMatchesQuery(skill, normalizedQuery))
          .map((skill) => ({ id: `configured:${skill.id}`, skill, type: "configured" }))

  const seenRecommendedPackageKeys = new Set<string>()
  const recommendedItems: OrganizationSkillRecommendationItem[] =
    filter === "configured"
      ? []
      : providerRecommendations
          .filter((recommendation) => {
            if (!providerRecommendationMatchesQuery(recommendation, normalizedQuery)) {
              return false
            }
            const packageKey = organizationSkillPackageKey(recommendation.packageName)
            if (
              !packageKey ||
              organizationSkillPackageLinked(configuredPackageKeys, recommendation.packageName) ||
              seenRecommendedPackageKeys.has(packageKey)
            ) {
              return false
            }
            seenRecommendedPackageKeys.add(packageKey)
            return true
          })
          .map((recommendation) => ({
            id: `recommended:${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`,
            recommendation,
            type: "recommended",
          }))

  return [...configuredItems, ...recommendedItems]
}

export function organizationRuntimeStatusLabel(
  state: OrganizationSkillRuntimeState,
  t: ReturnType<typeof useAppI18n>["t"],
): string {
  switch (state) {
    case "installed-same":
      return t("skills.organizationRuntimeInstalled")
    case "installed-modified":
      return t("skills.organizationRuntimeModified")
    case "installed-version-mismatch":
      return t("skills.organizationRuntimeVersionMismatch")
    case "same-id-different-package":
      return t("skills.organizationRuntimePackageConflict")
    case "local-conflict":
    case "unknown-conflict":
      return t("skills.organizationRuntimeLocalConflict")
    case "external-only":
    case "missing":
      return t("skills.organizationRuntimeMissing")
  }
}

export function organizationRuntimeStatusTone(state: OrganizationSkillRuntimeState): "attention" | "pending" | "ready" {
  return state === "installed-same"
    ? "ready"
    : state === "missing" || state === "external-only"
      ? "pending"
      : "attention"
}

export function shouldShowOrganizationRuntimeStatusOnCard(state: OrganizationSkillRuntimeState): boolean {
  return state !== "installed-same" && state !== "missing" && state !== "external-only"
}

export function canOpenManagedOrganizationSkill(state: OrganizationSkillRuntimeState): boolean {
  return (
    state === "installed-same" ||
    state === "installed-modified" ||
    state === "installed-version-mismatch" ||
    state === "local-conflict" ||
    state === "same-id-different-package" ||
    state === "unknown-conflict"
  )
}

export function shouldOpenOrganizationSkillManagement(state: OrganizationSkillRuntimeState): boolean {
  return (
    state === "external-only" ||
    state === "installed-same" ||
    state === "installed-modified" ||
    state === "installed-version-mismatch"
  )
}

export interface OrganizationSkillRuntimeInstallTarget {
  packageName: string
  skillName: string
}

export function buildInstallableOrganizationRecommendationSkills({
  groupById,
  items,
}: {
  groupById: ManagedSkillGroupById
  items: readonly OrganizationSkillRecommendationItem[]
}): OrganizationSkillRuntimeInstallTarget[] {
  const seenSkillKeys = new Set<string>()
  const installableSkills: OrganizationSkillRuntimeInstallTarget[] = []

  for (const item of items) {
    const skill =
      item.type === "configured"
        ? getInstallableConfiguredSkill(groupById, item.skill)
        : getInstallableRecommendedSkill(item.recommendation)
    if (!skill) {
      continue
    }

    const key = organizationSkillIdentityKey(skill.packageName, skill.skillName)
    if (!key || seenSkillKeys.has(key)) {
      continue
    }
    seenSkillKeys.add(key)
    installableSkills.push(skill)
  }

  return installableSkills
}

function getInstallableConfiguredSkill(
  groupById: ManagedSkillGroupById,
  skill: UseOrganizationSkills["skills"][number],
): OrganizationSkillRuntimeInstallTarget | null {
  const state = getOrganizationSkillRuntimeStatus(groupById, skill).state
  return skill.enabled && (state === "missing" || state === "external-only")
    ? { packageName: skill.packageName, skillName: skill.skillName }
    : null
}

function getInstallableRecommendedSkill(
  recommendation: ProviderSkillRecommendation,
): OrganizationSkillRuntimeInstallTarget | null {
  return canInstallProviderRecommendationRuntime(recommendation)
    ? { packageName: recommendation.packageName, skillName: recommendation.skillId }
    : null
}
