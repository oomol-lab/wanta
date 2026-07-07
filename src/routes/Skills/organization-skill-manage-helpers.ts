import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { OrganizationSkillFilter } from "./SkillPageHeader.tsx"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { useAppI18n } from "@/i18n"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations.ts"

import { organizationSkillIdentityKey } from "./organization-management-model.ts"
import { getOrganizationSkillRuntimeStatus } from "./skill-route-model.ts"

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
  const configuredSkillKeys = new Set(
    skills.map((skill) => organizationSkillIdentityKey(skill.packageName, skill.skillName)).filter(Boolean),
  )
  const configuredItems: OrganizationSkillRecommendationItem[] =
    filter === "recommended"
      ? []
      : skills
          .filter((skill) => organizationSkillMatchesQuery(skill, normalizedQuery))
          .map((skill) => ({ id: `configured:${skill.id}`, skill, type: "configured" }))

  const seenRecommendedKeys = new Set<string>()
  const recommendedItems: OrganizationSkillRecommendationItem[] =
    filter === "configured"
      ? []
      : providerRecommendations
          .filter((recommendation) => {
            const key = organizationSkillIdentityKey(recommendation.packageName, recommendation.skillId)
            if (configuredSkillKeys.has(key) || seenRecommendedKeys.has(key)) {
              return false
            }
            seenRecommendedKeys.add(key)
            return providerRecommendationMatchesQuery(recommendation, normalizedQuery)
          })
          .map((recommendation) => ({
            id: `recommended:${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`,
            recommendation,
            type: "recommended",
          }))

  return [...configuredItems, ...recommendedItems]
}

export function organizationRuntimeStatusLabel(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
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

export function organizationRuntimeStatusTone(
  state: ReturnType<typeof getOrganizationSkillRuntimeStatus>["state"],
): "attention" | "pending" | "ready" {
  return state === "installed-same"
    ? "ready"
    : state === "missing" || state === "external-only"
      ? "pending"
      : "attention"
}
