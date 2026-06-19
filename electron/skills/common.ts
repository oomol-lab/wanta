import type { BuiltInSkillId } from "./constants.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type BuiltInSkillStatus = "installed" | "missing" | "unknown"
export type { BuiltInSkillId }
export type SkillControlState = "controlled" | "modified" | "source-missing" | "unknown"
export type ManagedSkillKind = "bundled" | "registry" | "local" | "unknown"
export type SkillHostStatus = "installed" | "missing"
export type SkillHostScope = "external" | "runtime"

export interface BuiltInSkillCoverage {
  id: string
  name: string
  status: BuiltInSkillStatus
  installedAgents: string[]
  missingAgents: string[]
}

export interface SkillSummaryItem {
  attentionHosts: number
  description?: string
  icon?: string
  id: string
  installedHosts: number
  kind: ManagedSkillKind
  modifiedHosts: number
  name: string
  packageName?: string
  publishableHosts: number
  sourceMissingHosts: number
  totalHosts: number
  unknownHosts: number
  version?: string
}

export interface SkillSummary {
  builtInTotal: number
  builtInInstalled: number
  builtInMissing: number
  localSkills: number
  managedSkills: number
  modifiedHosts: number
  needsAttention: number
  publishableSkills: number
  registrySkills: number
  sourceMissingHosts: number
  builtInSkills: BuiltInSkillCoverage[]
  nonBuiltInSkills: SkillSummaryItem[]
}

export function selectSkillShortcuts(summary: SkillSummary, limit = 3): SkillSummaryItem[] {
  return summary.nonBuiltInSkills
    .slice()
    .sort((left, right) => {
      if (left.attentionHosts !== right.attentionHosts) {
        return right.attentionHosts - left.attentionHosts
      }

      const leftPublishWeight = left.kind === "local" ? 1 : 0
      const rightPublishWeight = right.kind === "local" ? 1 : 0
      if (leftPublishWeight !== rightPublishWeight) {
        return rightPublishWeight - leftPublishWeight
      }

      return left.name.localeCompare(right.name)
    })
    .slice(0, limit)
}

export interface ManagedSkillHostCoverage {
  agentId: string
  agentName: string
  kind?: ManagedSkillKind
  packageName?: string
  path?: string
  scope: SkillHostScope
  controlState?: SkillControlState
  sourcePath?: string
  status: SkillHostStatus
  version?: string
}

export interface ManagedSkillGroup {
  description?: string
  icon?: string
  id: string
  name: string
  isBuiltIn: boolean
  kind: ManagedSkillKind
  packageName?: string
  version?: string
  externalHosts: ManagedSkillHostCoverage[]
  hosts: ManagedSkillHostCoverage[]
  runtimeHosts: ManagedSkillHostCoverage[]
}

export interface LocalSkillProject {
  agentId: string
  agentName: string
  description: string
  icon?: string
  id: string
  name: string
  packageName?: string
  path: string
  version?: string
}

export interface SkillInventory {
  groups: ManagedSkillGroup[]
  localProjects: LocalSkillProject[]
  summary: SkillSummary
  updatedAt: string
}

export interface PublicSkillPackageMaintainer {
  id?: string
  name: string
  url?: string
}

export interface PublicSkillPackageSkill {
  description?: string
  name: string
  title: string
}

export interface PublicSkillPackage {
  description?: string
  displayName: string
  downloadCount?: number
  icon?: string
  id: string
  isTemplate: boolean
  maintainers: PublicSkillPackageMaintainer[]
  name: string
  skills: PublicSkillPackageSkill[]
  updateTime?: number
  version: string
  visibility: "private" | "public" | "unknown"
}

export interface PublicSkillPackageCatalog {
  items: PublicSkillPackage[]
  next: string | null
  updatedAt: string
}

export interface SkillInventoryChangedEvent {
  updatedAt: string
}

export interface SkillCliChangedEvent {
  updatedAt: string
}

export type SkillVersionStatus = "current" | "update-available" | "not-checkable" | "unknown" | "failed"
export type SkillCliVersionStatus = "up-to-date" | "update-available" | "unsupported" | "unavailable" | "failed"

export interface SkillPackageVersionCheck {
  command?: string[]
  currentVersion?: string
  error?: string
  id: string
  kind: ManagedSkillKind
  latestVersion?: string
  name: string
  packageName?: string
  skillId: string
  status: SkillVersionStatus
}

export interface SkillCliVersionCheck {
  command: string[]
  currentVersion?: string
  error?: string
  latestVersion?: string
  raw?: string
  status: SkillCliVersionStatus
}

export interface SkillVersionSummary {
  bundledSkillUpdates: number
  cliUpdates: number
  errors: number
  registrySkillUpdates: number
  totalUpdates: number
}

export interface SkillVersionReport {
  checkedAt: string
  cli: SkillCliVersionCheck
  skills: SkillPackageVersionCheck[]
  summary: SkillVersionSummary
}

export interface CheckSkillVersionsRequest {
  forceRefresh?: boolean
}

export interface ExecuteSkillUpdateRequest {
  packageName?: string
  skillId?: string
}

export interface InstallBuiltInSkillRequest {
  skillId: BuiltInSkillId
}

export interface UpdateRegistrySkillRequest {
  packageName?: string
  skillId?: string
}

export interface SkillSearchRequest {
  query: string
}

export interface ListPublicSkillPackagesRequest {
  forceRefresh?: boolean
  next?: string
}

export interface SkillSearchResult {
  description?: string
  displayName: string
  id: string
  packageName: string
  skillId: string
  version?: string
}

export interface InstallRegistrySkillRequest {
  packageName: string
  skillId: string
}

export interface OpenSkillPathRequest {
  path: string
}

export interface DeleteSkillRequest {
  confirmed: boolean
  skillId: string
}

export type SkillService = typeof SkillService

export const SkillService = serviceName("skill-service") as ServiceName<{
  ServerEvents: {
    skillInventoryChanged: SkillInventoryChangedEvent
  }
  ClientInvokes: {
    getSkillInventory(): Promise<SkillInventory>
    getSkillSummary(): Promise<SkillSummary>
    deleteSkill(request: DeleteSkillRequest): Promise<SkillInventory>
    installBuiltInSkill(request: InstallBuiltInSkillRequest): Promise<SkillInventory>
    installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory>
    listPublicSkillPackages(request?: ListPublicSkillPackagesRequest): Promise<PublicSkillPackageCatalog>
    checkSkillVersions(request?: CheckSkillVersionsRequest): Promise<SkillVersionReport>
    executeCliUpdate(): Promise<SkillVersionReport>
    executeRegistrySkillUpdate(request: ExecuteSkillUpdateRequest): Promise<SkillVersionReport>
    openSkillFolder(request: OpenSkillPathRequest): Promise<void>
    searchRegistrySkills(request: SkillSearchRequest): Promise<SkillSearchResult[]>
    updateRegistrySkill(request: UpdateRegistrySkillRequest): Promise<SkillInventory>
  }
}>
