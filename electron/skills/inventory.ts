import type { SupportedAgent } from "../agents/catalog.ts"
import type {
  BuiltInSkillCoverage,
  LocalSkillProject,
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  MyPublishedSkillConflict,
  MyPublishedSkillInstallState,
  SkillInventory,
  SkillSummary,
  SkillSummaryItem,
} from "./common.ts"
import type { InstalledSkill, SkillManifestStore } from "./types.ts"

import { builtInSkillIconById, builtInSkillIds, builtInSkillOrderById } from "./constants.ts"
import { readControlState } from "./manifest.ts"

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
      sourcePath: installedSkill.sourcePath,
      status: "installed",
      version: installedSkill.metadata.version,
    }
  })
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
    const description = matchedSkills.find((skill) => skill.metadata.description)?.metadata.description
    const icon = matchedSkills.find((skill) => skill.metadata.icon)?.metadata.icon ?? readBuiltInSkillIcon(skillName)
    const isBuiltIn = builtInSkillIds.includes(skillName as (typeof builtInSkillIds)[number])

    return {
      description,
      icon,
      id: skillName,
      name: skillName,
      isBuiltIn,
      kind: firstMetadata?.kind ?? (isBuiltIn ? "bundled" : "unknown"),
      packageName: firstMetadata?.packageName,
      version: firstMetadata?.version,
      hosts: createHostCoverage(skillName, installedSkills, manifestStore, coverageAgents),
    }
  })
}

function getInstalledAgents(installedSkills: InstalledSkill[]): SupportedAgent[] {
  const agentsById = new Map<string, SupportedAgent>()

  for (const skill of installedSkills) {
    agentsById.set(skill.agent.id, skill.agent)
  }

  return Array.from(agentsById.values()).sort((left, right) => left.name.localeCompare(right.name))
}

export interface MyPublishedSkillInstallResolution {
  conflictingSkill?: MyPublishedSkillConflict
  installed: boolean
  installedVersion?: string
  installState: MyPublishedSkillInstallState
}

export function resolveMyPublishedSkillInstallState(
  inventory: Pick<SkillInventory, "groups">,
  request: { packageName: string; skillId: string },
): MyPublishedSkillInstallResolution {
  let installedSkill: { version?: string } | undefined
  let conflictingSkill: MyPublishedSkillConflict | undefined

  for (const group of inventory.groups) {
    if (group.id !== request.skillId) {
      continue
    }

    const installedHosts = group.hosts.filter((host) => host.status === "installed")
    for (const host of installedHosts) {
      const hostPackageName = host.packageName ?? group.packageName
      if (hostPackageName === request.packageName) {
        installedSkill ??= {
          version: host.version ?? group.version,
        }
        continue
      }

      if (!conflictingSkill) {
        const conflictInstalledHosts = installedHosts.filter((entry) => {
          const entryPackageName = entry.packageName ?? group.packageName
          return entryPackageName !== request.packageName
        }).length
        const conflict: MyPublishedSkillConflict = {
          id: group.id,
          installedHosts: conflictInstalledHosts,
          kind: host.kind ?? group.kind,
          name: group.name,
          totalHosts: group.hosts.length,
        }
        if (hostPackageName) {
          conflict.packageName = hostPackageName
        }
        if (host.version ?? group.version) {
          conflict.version = host.version ?? group.version
        }
        conflictingSkill = conflict
      }
    }
  }

  if (installedSkill) {
    const resolution: MyPublishedSkillInstallResolution = {
      installed: true,
      installState: "installed",
    }
    if (installedSkill.version) {
      resolution.installedVersion = installedSkill.version
    }
    return resolution
  }

  if (conflictingSkill) {
    return {
      conflictingSkill,
      installed: false,
      installState: "name-conflict",
    }
  }

  return {
    installed: false,
    installState: "installable",
  }
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
  return builtInSkillIds.includes(skillName as (typeof builtInSkillIds)[number])
    ? builtInSkillIconById[skillName as (typeof builtInSkillIds)[number]]
    : undefined
}

function readBuiltInSkillOrder(skillName: string): number | undefined {
  return builtInSkillIds.includes(skillName as (typeof builtInSkillIds)[number])
    ? builtInSkillOrderById[skillName as (typeof builtInSkillIds)[number]]
    : undefined
}

export function buildSummary(
  groups: ManagedSkillGroup[],
  localProjects: readonly LocalSkillProject[] = [],
): SkillSummary {
  const builtInSkills: BuiltInSkillCoverage[] = builtInSkillIds.map((skillId) => {
    const group = groups.find((item) => item.id === skillId)
    const installedAgents = group?.hosts.filter((host) => host.status === "installed").map((host) => host.agentId) ?? []
    const missingAgents = group?.hosts.filter((host) => host.status === "missing").map((host) => host.agentId) ?? []
    const status: BuiltInSkillCoverage["status"] =
      installedAgents.length > 0 ? "installed" : missingAgents.length > 0 ? "missing" : "unknown"

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
  const installedGroups = groups.filter((group) => group.hosts.some((host) => host.status === "installed"))
  const localSkills = installedGroups.filter((group) => group.kind === "local").length
  const registrySkills = installedGroups.filter((group) => group.kind === "registry").length
  const modifiedHosts = groups.reduce(
    (count, group) => count + group.hosts.filter((host) => host.controlState === "modified").length,
    0,
  )
  const sourceMissingHosts = groups.reduce(
    (count, group) => count + group.hosts.filter((host) => host.controlState === "source-missing").length,
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
  const installedHosts = group.hosts.filter((host) => host.status === "installed").length
  const modifiedHosts = group.hosts.filter((host) => host.controlState === "modified").length
  const sourceMissingHosts = group.hosts.filter((host) => host.controlState === "source-missing").length
  const unknownHosts = group.hosts.filter(
    (host) => host.status === "installed" && host.controlState === "unknown",
  ).length
  const publishableHosts =
    group.kind === "local" && group.packageName ? group.hosts.filter((host) => host.status === "installed").length : 0
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
    totalHosts: group.hosts.length,
    unknownHosts,
    version: group.version,
  }
}
