import type { SupportedAgent } from "../agents/catalog.ts"
import type {
  BuiltInSkillCoverage,
  LocalSkillProject,
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  SkillSummary,
  SkillSummaryItem,
} from "./common.ts"
import type { InstalledSkill, SkillManifestStore } from "./types.ts"

import { builtInSkillIconById, builtInSkillIds, builtInSkillOrderById } from "./constants.ts"
import { readControlState } from "./manifest.ts"

const lumoRuntimeHostId = "lumo"
const lumoRuntimeHostName = "Lumo"

function isLumoRuntimeAgent(agent: SupportedAgent): boolean {
  return agent.id === lumoRuntimeHostId
}

function createHostCoverage(
  skillName: string,
  installedSkills: InstalledSkill[],
  manifestStore: SkillManifestStore,
  agents: readonly SupportedAgent[],
): ManagedSkillHostCoverage[] {
  return agents.map((agent) => {
    const installedSkill = installedSkills.find((skill) => skill.agent.id === agent.id && skill.name === skillName)

    if (!installedSkill) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        scope: isLumoRuntimeAgent(agent) ? "runtime" : "external",
        status: "missing",
      }
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      controlState: readControlState(installedSkill, manifestStore),
      kind: installedSkill.metadata.kind,
      packageName: installedSkill.metadata.packageName,
      path: installedSkill.path,
      scope: isLumoRuntimeAgent(agent) ? "runtime" : "external",
      sourcePath: installedSkill.sourcePath,
      status: "installed",
      version: installedSkill.metadata.version,
    }
  })
}

function createRuntimeHostCoverage(
  group: Pick<ManagedSkillGroup, "kind" | "packageName" | "version">,
  externalHosts: ManagedSkillHostCoverage[],
): ManagedSkillHostCoverage[] {
  const installedHosts = externalHosts.filter((host) => host.status === "installed")

  if (installedHosts.length === 0) {
    return []
  }

  const representativeHost = installedHosts[0]
  const runtimeHost: ManagedSkillHostCoverage = {
    agentId: lumoRuntimeHostId,
    agentName: lumoRuntimeHostName,
    kind: representativeHost?.kind ?? group.kind,
    packageName: representativeHost?.packageName ?? group.packageName,
    scope: "runtime",
    status: "installed",
    version: representativeHost?.version ?? group.version,
  }

  if (representativeHost?.path) {
    runtimeHost.path = representativeHost.path
  }
  if (representativeHost?.sourcePath) {
    runtimeHost.sourcePath = representativeHost.sourcePath
  }

  return [runtimeHost]
}

export function groupInstalledSkills(
  installedSkills: InstalledSkill[],
  manifestStore: SkillManifestStore,
  agents?: readonly SupportedAgent[],
): ManagedSkillGroup[] {
  const coverageAgents = agents ?? getInstalledAgents(installedSkills)
  const skillNames = Array.from(new Set([...builtInSkillIds, ...installedSkills.map((skill) => skill.name)])).sort(
    compareSkillNames,
  )

  return skillNames.map((skillName) => {
    const matchedSkills = installedSkills.filter((skill) => skill.name === skillName)
    const firstMetadata = matchedSkills[0]?.metadata
    const resolvedKind = resolveGroupKind(matchedSkills, isBuiltInSkillName(skillName))
    const description = matchedSkills.find((skill) => skill.metadata.description)?.metadata.description
    const icon = matchedSkills.find((skill) => skill.metadata.icon)?.metadata.icon ?? readBuiltInSkillIcon(skillName)
    const isBuiltIn = isBuiltInSkillName(skillName)

    const coveredHosts = createHostCoverage(skillName, installedSkills, manifestStore, coverageAgents)
    const hasNativeRuntimeHosts = coveredHosts.some((host) => host.scope === "runtime")
    const externalHosts = coveredHosts.filter((host) => host.scope === "external")
    const runtimeHosts = hasNativeRuntimeHosts
      ? coveredHosts.filter((host) => host.scope === "runtime")
      : createRuntimeHostCoverage(
          {
            kind: resolvedKind,
            packageName: firstMetadata?.packageName,
            version: firstMetadata?.version,
          },
          externalHosts,
        )
    return {
      description,
      icon,
      id: skillName,
      name: skillName,
      isBuiltIn,
      kind: resolvedKind,
      packageName: firstMetadata?.packageName,
      version: firstMetadata?.version,
      externalHosts,
      hosts: hasNativeRuntimeHosts ? runtimeHosts : externalHosts,
      runtimeHosts,
    }
  })
}

function resolveGroupKind(matchedSkills: InstalledSkill[], isBuiltIn: boolean): ManagedSkillGroup["kind"] {
  const kinds = new Set(matchedSkills.map((skill) => skill.metadata.kind).filter((kind) => kind !== undefined))
  if (kinds.size === 1) {
    return Array.from(kinds)[0] ?? (isBuiltIn ? "bundled" : "unknown")
  }
  if (kinds.size > 1) {
    return isBuiltIn ? "bundled" : "unknown"
  }
  return isBuiltIn ? "bundled" : "unknown"
}

function isBuiltInSkillName(skillName: string): boolean {
  return builtInSkillIds.includes(skillName as (typeof builtInSkillIds)[number])
}

function getInstalledAgents(installedSkills: InstalledSkill[]): SupportedAgent[] {
  const agentsById = new Map<string, SupportedAgent>()

  for (const skill of installedSkills) {
    agentsById.set(skill.agent.id, skill.agent)
  }

  return Array.from(agentsById.values()).sort((left, right) => left.name.localeCompare(right.name))
}

function compareSkillNames(left: string, right: string): number {
  const leftIndex = readBuiltInSkillOrder(left)
  const rightIndex = readBuiltInSkillOrder(right)

  if (leftIndex !== undefined || rightIndex !== undefined) {
    return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER)
  }

  return left.localeCompare(right)
}

function readBuiltInSkillIcon(skillName: string): string | undefined {
  return isBuiltInSkillName(skillName) ? builtInSkillIconById[skillName as (typeof builtInSkillIds)[number]] : undefined
}

function readBuiltInSkillOrder(skillName: string): number | undefined {
  return isBuiltInSkillName(skillName)
    ? builtInSkillOrderById[skillName as (typeof builtInSkillIds)[number]]
    : undefined
}

export function buildSummary(
  groups: ManagedSkillGroup[],
  localProjects: readonly LocalSkillProject[] = [],
): SkillSummary {
  const builtInSkills: BuiltInSkillCoverage[] = builtInSkillIds.map((skillId) => {
    const group = groups.find((item) => item.id === skillId)
    const runtimeHosts = group?.runtimeHosts ?? []
    const installedAgents = runtimeHosts.filter((host) => host.status === "installed").map((host) => host.agentId)
    const missingAgents: string[] = []
    const status: BuiltInSkillCoverage["status"] = installedAgents.length > 0 ? "installed" : "unknown"

    return {
      id: skillId,
      name: skillId,
      status,
      installedAgents,
      missingAgents,
    }
  })
  const builtInInstalled = builtInSkills.filter((skill) => skill.status === "installed").length
  const builtInMissing = builtInSkills.filter((skill) => skill.status === "missing").length
  const installedGroups = groups.filter((group) => group.runtimeHosts.some((host) => host.status === "installed"))
  const localSkills = installedGroups.filter((group) => group.kind === "local").length
  const registrySkills = installedGroups.filter((group) => group.kind === "registry").length
  const modifiedHosts = groups.reduce(
    (count, group) => count + group.runtimeHosts.filter((host) => host.controlState === "modified").length,
    0,
  )
  const sourceMissingHosts = groups.reduce(
    (count, group) => count + group.runtimeHosts.filter((host) => host.controlState === "source-missing").length,
    0,
  )
  const publishableSkills = installedGroups.filter((group) => group.kind === "local").length + localProjects.length
  const nonBuiltInSkills = installedGroups
    .filter((group) => !group.isBuiltIn)
    .map(toSkillSummaryItem)
    .sort((left, right) => {
      if (left.attentionHosts !== right.attentionHosts) {
        return right.attentionHosts - left.attentionHosts
      }

      return left.name.localeCompare(right.name)
    })

  return {
    builtInTotal: builtInSkills.length,
    builtInInstalled,
    builtInMissing,
    localSkills,
    managedSkills: installedGroups.length,
    modifiedHosts,
    needsAttention: builtInMissing + modifiedHosts + sourceMissingHosts,
    publishableSkills,
    registrySkills,
    sourceMissingHosts,
    builtInSkills,
    nonBuiltInSkills,
  }
}

function toSkillSummaryItem(group: ManagedSkillGroup): SkillSummaryItem {
  const installedHosts = group.runtimeHosts.filter((host) => host.status === "installed").length
  const modifiedHosts = group.runtimeHosts.filter((host) => host.controlState === "modified").length
  const sourceMissingHosts = group.runtimeHosts.filter((host) => host.controlState === "source-missing").length
  const unknownHosts = group.runtimeHosts.filter(
    (host) => host.status === "installed" && host.controlState === "unknown",
  ).length
  const publishableHosts =
    group.kind === "local" && group.packageName
      ? group.runtimeHosts.filter((host) => host.status === "installed").length
      : 0
  const attentionHosts = modifiedHosts + sourceMissingHosts

  return {
    attentionHosts,
    description: group.description,
    icon: group.icon,
    id: group.id,
    installedHosts,
    kind: group.kind,
    modifiedHosts,
    name: group.name,
    packageName: group.packageName,
    publishableHosts,
    sourceMissingHosts,
    totalHosts: group.runtimeHosts.length,
    unknownHosts,
    version: group.version,
  }
}
