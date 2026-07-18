import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type SkillControlState = "controlled" | "modified" | "source-missing" | "unknown"
export type ManagedSkillKind = "registry" | "local" | "unknown"
export type SkillHostStatus = "installed" | "missing"
export type SkillHostScope = "external" | "runtime"

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
  localSkills: number
  managedSkills: number
  modifiedHosts: number
  needsAttention: number
  publishableSkills: number
  registrySkills: number
  sourceMissingHosts: number
  skills: SkillSummaryItem[]
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
  kind: ManagedSkillKind
  packageName?: string
  version?: string
  externalHosts: ManagedSkillHostCoverage[]
  hosts: ManagedSkillHostCoverage[]
  runtimeHosts: ManagedSkillHostCoverage[]
}

export interface SkillInventory {
  groups: ManagedSkillGroup[]
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

export interface UpdateRegistrySkillRequest {
  packageName?: string
  skillId?: string
}

export interface InstallRegistrySkillRequest {
  packageName: string
  skillId: string
}

export interface InstallRegistrySkillsResult {
  failures: Array<InstallRegistrySkillRequest & { error: string }>
  installed: InstallRegistrySkillRequest[]
  inventory: SkillInventory
}

export interface OpenSkillPathRequest {
  path: string
}

export interface SkillDocumentRequest {
  path: string
}

export interface SkillDocument {
  content: string
  path: string
}

export interface PublishSkillRequest {
  path: string
  visibility?: "private" | "public"
}

export interface PublishSkillResult {
  inventory: SkillInventory
  message: string
  packageName: string
  version: string
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
    deleteSkill(request: DeleteSkillRequest): Promise<SkillInventory>
    installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory>
    installRegistrySkills(requests: InstallRegistrySkillRequest[]): Promise<InstallRegistrySkillsResult>
    checkSkillVersions(request?: CheckSkillVersionsRequest): Promise<SkillVersionReport>
    executeCliUpdate(): Promise<SkillVersionReport>
    openSkillDocument(request: SkillDocumentRequest): Promise<void>
    openSkillFolder(request: OpenSkillPathRequest): Promise<void>
    publishSkill(request: PublishSkillRequest): Promise<PublishSkillResult>
    readSkillDocument(request: SkillDocumentRequest): Promise<SkillDocument>
    updateRegistrySkill(request: UpdateRegistrySkillRequest): Promise<SkillInventory>
  }
}>
