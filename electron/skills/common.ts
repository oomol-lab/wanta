import type { BuiltInSkillId } from "./constants.ts"
import type { SkillEditorApp, SkillEditorAppId } from "./editor-launcher.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type { SkillEditorApp, SkillEditorAppId } from "./editor-launcher.ts"

export type BuiltInSkillStatus = "installed" | "missing" | "unknown"
export type { BuiltInSkillId }
export type SkillControlState = "controlled" | "modified" | "source-missing" | "unknown"
export type ManagedSkillKind = "bundled" | "registry" | "local" | "unknown"
export type SkillHostStatus = "installed" | "missing"

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
  hosts: ManagedSkillHostCoverage[]
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

export type MyPublishedSkillInstallState = "installed" | "installable" | "name-conflict"

export interface MyPublishedSkillConflict {
  id: string
  installedHosts: number
  kind: ManagedSkillKind
  name: string
  packageName?: string
  totalHosts: number
  version?: string
}

export interface MyPublishedSkill {
  conflictingSkill?: MyPublishedSkillConflict
  description?: string
  displayName: string
  icon?: string
  id: string
  installState: MyPublishedSkillInstallState
  installed: boolean
  installedVersion?: string
  packageName: string
  packageVersion: string
  skillId: string
  updateTime?: number
  visibility: "private" | "public" | "unknown"
}

export interface MyPublishedSkillCatalog {
  items: MyPublishedSkill[]
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

export type SkillRepairPlanKind = "reset" | "restore-source"
export type SkillRepairPlanStatus = "ready" | "not-needed" | "not-found" | "unsupported"

export interface SkillRepairPlanTarget {
  agentId: string
  agentName: string
  currentPath: string
  sourcePath: string
  controlState: SkillControlState
}

export interface SkillRepairPlan {
  id: string
  kind: SkillRepairPlanKind
  status: SkillRepairPlanStatus
  skillId: string
  skillName: string
  isDestructive: boolean
  requiresConfirmation: boolean
  targets: SkillRepairPlanTarget[]
  packageName?: string
  version?: string
  reason?: string
}

export interface SkillRepairPlanRequest {
  agentId?: string
  kind: SkillRepairPlanKind
  skillId: string
}

export interface ExecuteSkillRepairPlanRequest extends SkillRepairPlanRequest {
  confirmedPlanId: string
}

export type SkillRepairExecutionStatus = "not-needed" | "succeeded" | "unsupported"

export interface SkillRepairExecutionResult {
  affectedTargets: number
  plan: SkillRepairPlan
  status: SkillRepairExecutionStatus
}

export interface InstallBuiltInSkillRequest {
  skillId: BuiltInSkillId
}

export interface UpdateRegistrySkillRequest {
  packageName?: string
  skillId?: string
}

export type SkillSyncDirection = "apply" | "upload"

export interface SyncRegistrySkillsRequest {
  direction: SkillSyncDirection
}

export interface SyncRegistrySkillsResult {
  direction: SkillSyncDirection
  inventory: SkillInventory
}

export interface SkillSearchRequest {
  query: string
}

export interface ListMyPublishedSkillsRequest {
  forceRefresh?: boolean
  next?: string
  query?: string
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

export interface ReplaceConflictingRegistrySkillRequest {
  confirmed: boolean
  packageName: string
  skillId: string
}

export interface OpenSkillPathRequest {
  path: string
}

export interface OpenSkillInEditorRequest {
  editorId?: SkillEditorAppId
  path: string
}

export interface PublishSkillRequest {
  path: string
  visibility?: "private" | "public"
}

export interface PublishSkillResult {
  inventory: SkillInventory
  message: string
}

export interface AdoptLocalSkillProjectRequest {
  agentId?: string
  description?: string
  icon?: string
  name?: string
  path: string
  title?: string
}

export interface AdoptLocalSkillProjectResult {
  inventory: SkillInventory
  message: string
  skillId: string
}

export interface ShareSkillRequest {
  days?: number
  downloads?: number
  language?: "en" | "zh"
  sourcePath?: string
  skillId: string
}

export interface SkillShareInfoRequest {
  packageName?: string
}

export interface SkillShareInfo {
  limitsRequired: boolean
  packageName?: string
  visibility: "private" | "public" | "unpublished"
}

export interface SkillShareResult {
  copied?: boolean
  installCommand?: string
  message?: string
  prompt: string
}

export interface DeleteSkillRequest {
  agentId?: string
  confirmed: boolean
  skillId: string
}

export type SkillEnablePlanStatus = "ready" | "not-needed" | "unsupported"
export type SkillEnablePlanTargetAction = "create" | "overwrite"

export interface SkillEnablePlanTarget {
  action: SkillEnablePlanTargetAction
  agentId: string
  agentName: string
  path?: string
}

export interface SkillEnablePlan {
  id: string
  requiresConfirmation: boolean
  skillId: string
  skillName: string
  sourceAgentId?: string
  sourceAgentName?: string
  sourcePath?: string
  status: SkillEnablePlanStatus
  targets: SkillEnablePlanTarget[]
}

export interface SkillEnablePlanRequest {
  skillId: string
  sourceAgentId?: string
}

export interface EnableSkillForAllAgentsRequest {
  confirmedPlanId?: string
  skillId: string
  sourceAgentId?: string
}

export type SkillService = typeof SkillService

export const SkillService = serviceName("skill-service") as ServiceName<{
  ServerEvents: {
    skillInventoryChanged: SkillInventoryChangedEvent
  }
  ClientInvokes: {
    executeSkillRepairPlan(request: ExecuteSkillRepairPlanRequest): Promise<SkillRepairExecutionResult>
    getSkillEnablePlan(request: SkillEnablePlanRequest): Promise<SkillEnablePlan>
    getSkillInventory(): Promise<SkillInventory>
    getSkillRepairPlan(request: SkillRepairPlanRequest): Promise<SkillRepairPlan>
    getSkillSummary(): Promise<SkillSummary>
    deleteSkill(request: DeleteSkillRequest): Promise<SkillInventory>
    enableSkillForAllAgents(request: EnableSkillForAllAgentsRequest): Promise<SkillInventory>
    installBuiltInSkill(request: InstallBuiltInSkillRequest): Promise<SkillInventory>
    installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory>
    listMyPublishedSkills(request?: ListMyPublishedSkillsRequest): Promise<MyPublishedSkillCatalog>
    listSkillEditors(): Promise<SkillEditorApp[]>
    checkSkillVersions(request?: CheckSkillVersionsRequest): Promise<SkillVersionReport>
    executeCliUpdate(): Promise<SkillVersionReport>
    executeRegistrySkillUpdate(request: ExecuteSkillUpdateRequest): Promise<SkillVersionReport>
    adoptLocalSkillProject(request: AdoptLocalSkillProjectRequest): Promise<AdoptLocalSkillProjectResult>
    openSkillFolder(request: OpenSkillPathRequest): Promise<void>
    openSkillInEditor(request: OpenSkillInEditorRequest): Promise<void>
    publishSkill(request: PublishSkillRequest): Promise<PublishSkillResult>
    replaceConflictingRegistrySkill(request: ReplaceConflictingRegistrySkillRequest): Promise<SkillInventory>
    searchRegistrySkills(request: SkillSearchRequest): Promise<SkillSearchResult[]>
    getSkillShareInfo(request: SkillShareInfoRequest): Promise<SkillShareInfo>
    shareSkill(request: ShareSkillRequest): Promise<SkillShareResult>
    syncRegistrySkills(request: SyncRegistrySkillsRequest): Promise<SyncRegistrySkillsResult>
    updateRegistrySkill(request: UpdateRegistrySkillRequest): Promise<SkillInventory>
  }
}>
