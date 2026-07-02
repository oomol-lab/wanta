import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ManagedSkillGroupById, PublicSkillInstallState } from "./skill-route-model.ts"

import {
  getPublicPackageInstallState,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
} from "./skill-route-model.ts"

export interface ProviderSkillCandidate {
  packageName: string
  providerDisplayName: string
  providerIconUrl?: string
  service: string
}

export interface ProviderSkillRecommendation extends ProviderSkillCandidate {
  installState: PublicSkillInstallState
  package: PublicSkillPackage
  skillId: string
}

const officialProviderSkillPackageNameByService = new Map<string, string>([
  ["amap", "oo-amap"],
  ["dida365", "oo-dida365"],
  ["github", "oo-github"],
  ["gmail", "oo-gmail"],
  ["googlecalendar", "oo-googlecalendar"],
  ["notion", "oo-notion"],
  ["slack", "oo-slack"],
])

export function resolveOfficialProviderSkillPackageName(service: string): string | null {
  const normalizedService = service.trim()
  if (!normalizedService) {
    return null
  }
  return officialProviderSkillPackageNameByService.get(normalizedService) ?? null
}

export function getConnectedProviderSkillCandidates(
  providers: readonly ConnectionProvider[],
): ProviderSkillCandidate[] {
  const seen = new Set<string>()
  const candidates: ProviderSkillCandidate[] = []

  for (const provider of providers) {
    const service = provider.service.trim()
    if (!service || provider.status !== "connected") {
      continue
    }
    if (provider.appStatus && provider.appStatus !== "active") {
      continue
    }
    if (seen.has(service)) {
      continue
    }
    const packageName = resolveOfficialProviderSkillPackageName(service)
    if (!packageName) {
      continue
    }
    seen.add(service)
    candidates.push({
      packageName,
      providerDisplayName: provider.displayName || service,
      ...(provider.iconUrl ? { providerIconUrl: provider.iconUrl } : {}),
      service,
    })
  }

  return candidates
}

export function buildProviderSkillRecommendations({
  groupById,
  packagesByService,
  providers,
}: {
  groupById: ManagedSkillGroupById | ReadonlyMap<string, ManagedSkillGroup> | undefined
  packagesByService: ReadonlyMap<string, PublicSkillPackage | null | undefined>
  providers: readonly ConnectionProvider[]
}): ProviderSkillRecommendation[] {
  return getConnectedProviderSkillCandidates(providers)
    .map((candidate) => {
      const pkg = packagesByService.get(candidate.service)
      if (!pkg) {
        return undefined
      }

      const installState = getPublicPackageInstallState(groupById, pkg)
      const skill = getPublicPackagePrimaryInstallSkill(groupById, pkg) ?? getPublicPackagePrimarySkill(pkg)
      if (!skill) {
        return undefined
      }

      return {
        ...candidate,
        installState,
        package: pkg,
        skillId: skill.name,
      }
    })
    .filter((item): item is ProviderSkillRecommendation => Boolean(item))
}

export function getInstallableProviderSkillRecommendations(
  recommendations: readonly ProviderSkillRecommendation[],
): ProviderSkillRecommendation[] {
  return recommendations.filter(
    (recommendation) =>
      recommendation.installState === "installable" || recommendation.installState === "partially-installed",
  )
}
