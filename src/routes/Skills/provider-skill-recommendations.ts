import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ManagedSkillGroupById, PublicSkillInstallState } from "./skill-route-model.ts"

import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"
import {
  canInstallPublicSkill,
  getPublicPackageInstallState,
  getPublicPackagePrimaryInstallSkill,
  getPublicPackagePrimarySkill,
} from "./skill-route-model.ts"

export interface ProviderSkillCandidate {
  providerDisplayName: string
  providerIconUrl?: string
  service: string
}

export interface ProviderSkillRecommendation extends ProviderSkillCandidate {
  installState: PublicSkillInstallState
  package: PublicSkillPackage
  packageName: string
  skillId: string
}

const providerServicePattern = /^[a-z0-9][a-z0-9._-]*$/

function normalizeProviderService(service: string): string {
  return service.trim().toLowerCase()
}

function uniqueSearchValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    const key = normalized.toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function compactSearchText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function packageSkillTexts(pkg: PublicSkillPackage): string[] {
  return [
    pkg.name,
    pkg.displayName,
    pkg.description ?? "",
    ...pkg.skills.flatMap((skill) => [skill.name, skill.title, skill.description ?? ""]),
  ]
}

export function getProviderSkillSearchQueries(candidate: ProviderSkillCandidate): string[] {
  const serviceWords = candidate.service.replace(/[._-]+/g, " ")
  return uniqueSearchValues([candidate.providerDisplayName, serviceWords, candidate.service])
}

export function getConventionalProviderSkillPackageName(candidate: ProviderSkillCandidate): string | null {
  const normalizedService = normalizeProviderService(candidate.service)
  return providerServicePattern.test(normalizedService) ? `oo-${normalizedService}` : null
}

export function scoreProviderSkillPackage(candidate: ProviderSkillCandidate, pkg: PublicSkillPackage): number {
  const providerNames = uniqueSearchValues([
    candidate.providerDisplayName,
    candidate.service,
    candidate.service.replace(/[._-]+/g, " "),
  ]).map(compactSearchText)
  const searchableTexts = packageSkillTexts(pkg).map(compactSearchText).filter(Boolean)
  const packageName = compactSearchText(pkg.name)
  let score = 0

  for (const providerName of providerNames) {
    if (!providerName) {
      continue
    }
    for (const text of searchableTexts) {
      if (text === providerName) {
        score += 100
      } else if (text.includes(providerName)) {
        score += 20
      }
    }
    if (packageName === `oo${providerName}`) {
      score += 40
    }
  }

  if (pkg.maintainers.some((maintainer) => maintainer.name.trim().toLowerCase() === "oomol")) {
    score += 5
  }

  return score
}

export function selectProviderSkillPackage(
  candidate: ProviderSkillCandidate,
  packages: readonly PublicSkillPackage[],
): PublicSkillPackage | null {
  let best: { pkg: PublicSkillPackage; score: number } | null = null
  for (const pkg of packages) {
    const score = scoreProviderSkillPackage(candidate, pkg)
    if (score <= 0) {
      continue
    }
    if (!best || score > best.score) {
      best = { pkg, score }
    }
  }
  return best?.pkg ?? null
}

/**
 * 精确命中 service 的包无需继续做其他关键词搜索。这里刻意只接受名称级别的强匹配，
 * 不以普通 score 阈值提前结束，避免把描述中偶然出现 provider 名的包误判为推荐。
 */
export function isHighConfidenceProviderSkillPackage(
  candidate: ProviderSkillCandidate,
  pkg: PublicSkillPackage,
): boolean {
  const service = compactSearchText(candidate.service)
  if (!service) {
    return false
  }

  const packageName = compactSearchText(pkg.name)
  if (packageName === service || packageName === `oo${service}`) {
    return true
  }

  return pkg.skills.some((skill) => {
    return compactSearchText(skill.name) === service || compactSearchText(skill.title) === service
  })
}

export function getConnectedProviderSkillCandidates(
  providers: readonly ConnectionProvider[],
): ProviderSkillCandidate[] {
  const seen = new Set<string>()
  const candidates: ProviderSkillCandidate[] = []

  for (const provider of providers) {
    const service = normalizeProviderService(provider.service)
    // 无需配置、对所有工作区默认可用的 no_auth 连接不代表用户自己的已连接服务，
    // 因此不据此推荐安装对应 Skill。
    if (
      !service ||
      !providerServicePattern.test(service) ||
      provider.status !== "connected" ||
      isConnectionlessNoAuthProvider(provider)
    ) {
      continue
    }
    if (provider.appStatus && provider.appStatus !== "active") {
      continue
    }
    if (seen.has(service)) {
      continue
    }
    seen.add(service)
    candidates.push({
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
  groupById: ManagedSkillGroupById | undefined
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
        packageName: pkg.name,
        skillId: skill.name,
      }
    })
    .filter((item): item is ProviderSkillRecommendation => Boolean(item))
}

export function getInstallableProviderSkillRecommendations(
  recommendations: readonly ProviderSkillRecommendation[],
): ProviderSkillRecommendation[] {
  const seenSkillKeys = new Set<string>()

  return recommendations.filter((recommendation) => {
    if (!canInstallPublicSkill(recommendation.installState)) {
      return false
    }

    const packageName = recommendation.packageName.trim().toLowerCase()
    const skillId = recommendation.skillId.trim().toLowerCase()
    const key = packageName && skillId ? `${packageName}\u0000${skillId}` : ""
    if (!key || seenSkillKeys.has(key)) {
      return false
    }
    seenSkillKeys.add(key)
    return true
  })
}
