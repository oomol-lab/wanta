import type { AuthManager } from "../auth/node.ts"
import type { OoCommandResult } from "../oo-command.ts"
import type {
  ExecuteSkillRepairPlanRequest,
  AdoptLocalSkillProjectRequest,
  AdoptLocalSkillProjectResult,
  CheckSkillVersionsRequest,
  DeleteSkillRequest,
  EnableSkillForAllAgentsRequest,
  ExecuteSkillUpdateRequest,
  InstallRegistrySkillRequest,
  InstallBuiltInSkillRequest,
  ListMyPublishedSkillsRequest,
  MyPublishedSkill,
  MyPublishedSkillCatalog,
  OpenSkillInEditorRequest,
  OpenSkillPathRequest,
  PublishSkillRequest,
  PublishSkillResult,
  ReplaceConflictingRegistrySkillRequest,
  ShareSkillRequest,
  SkillShareInfo,
  SkillShareInfoRequest,
  SkillInventoryChangedEvent,
  SkillInventory,
  SkillCliVersionCheck,
  SkillCliChangedEvent,
  SkillEnablePlan,
  SkillEnablePlanRequest,
  SkillPackageVersionCheck,
  SkillRepairExecutionResult,
  SkillRepairPlan,
  SkillRepairPlanRequest,
  SkillService,
  SkillSummary,
  SkillVersionReport,
  SyncRegistrySkillsRequest,
  SyncRegistrySkillsResult,
  UpdateRegistrySkillRequest,
} from "./common.ts"
import type { SkillEditorApp } from "./editor-launcher.ts"
import type { IConnectionService } from "@oomol/connection"
import type { FSWatcher } from "node:fs"

import { ConnectionService } from "@oomol/connection"
import { app, shell } from "electron"
import { watch } from "node:fs"
import { access, cp, mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { buildOoEnv } from "../agent/oo.ts"
import { listDiscoveredAgents, resolveAgentSkillRoot, supportedAgents } from "../agents/catalog.ts"
import { logDiagnosticOnChange } from "../diagnostics-log.ts"
import { ooEndpoint, registryBaseUrl, searchBaseUrl } from "../domain.ts"
import { normalizeOoCliVersion, runOoCommand } from "../oo-command.ts"
import { resolveOoStoreDirectory } from "../oo-store-paths.ts"
import { recordOperationHistory } from "../operation-history.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  assertSkillOperationSucceeded,
  createAdoptLocalSkillArgs,
  createDeleteSkillArgs,
  createBundledSkillVersionCheck,
  createCliCheckUpdateArgs,
  createCliUpdateArgs,
  createFailedRegistrySkillVersionCheck,
  createFailedSkillVersionCheck,
  createInstallRegistrySkillArgs,
  normalizeMyPublishedPackageList,
  createPublishedSkillVersionCheckFromPackageInfo,
  createPublishSkillArgs,
  createRegistryPackageInfoVersionCheckCommand,
  createRegistrySkillCheckUpdateArgs,
  createRegistrySkillVersionCheckFromUpdateResult,
  createShareSkillArgs,
  createSkillSearchArgs,
  createUpdateRegistrySkillArgs,
  normalizeCliCheckUpdateResult,
  normalizeRegistryPackageVersionInfo,
  normalizeRegistryPackageSkillInfo,
  normalizeRegistrySkillCheckUpdateResults,
  normalizeSkillShareInfo,
  normalizeSkillSearchResults,
  normalizeSkillShareResult,
} from "./actions.ts"
import { SkillService as SkillServiceName } from "./common.ts"
import { builtInSkillIds } from "./constants.ts"
import { launchEditorCommand, listSkillEditorApps, resolveEditorCommand } from "./editor-launcher.ts"
import { buildSummary, groupInstalledSkills, resolveMyPublishedSkillInstallState } from "./inventory.ts"
import {
  areManifestStoresEqual,
  readManifestStore,
  replaceManifestRecords,
  upsertManifestRecords,
  writeManifestStore,
} from "./manifest.ts"
import { buildSkillRepairPlan } from "./repair-plan.ts"
import { assertSafeResetPaths, resetSkillTargets } from "./reset.ts"
import { scanInstalledSkills, scanLocalSkillProjects } from "./scan.ts"
import { createSkillSyncArgs } from "./sync.ts"

const skillShareInfoCacheTtlMs = 5 * 60_000
const myPublishedSkillCatalogCacheTtlMs = 5 * 60_000

type AuthAccountSecret = ReturnType<AuthManager["getCurrentAuthSecret"]>

interface SkillVersionAuthSnapshot {
  account: AuthAccountSecret
  cacheKey: string
}

type RunSkillOoCommand = (
  args: string[],
  options: Omit<Parameters<typeof runOoCommand>[1], "env">,
) => Promise<OoCommandResult>

export class SkillServiceImpl extends ConnectionService<SkillService> implements IConnectionService<SkillService> {
  private readonly authService: AuthManager
  private readonly watchers: FSWatcher[] = []
  private readonly shareInfoCacheByKey = new Map<string, { info: SkillShareInfo; time: number }>()
  private readonly shareInfoInFlightByKey = new Map<string, Promise<SkillShareInfo>>()
  private readonly myPublishedSkillCatalogCacheByKey = new Map<
    string,
    { catalog: MyPublishedSkillCatalog; time: number }
  >()
  private readonly myPublishedSkillCatalogInFlightByKey = new Map<string, Promise<MyPublishedSkillCatalog>>()
  private shareInfoCacheGeneration = 0
  private myPublishedSkillCatalogCacheGeneration = 0
  private versionReportCache: { generation: number; key: string; report: SkillVersionReport; time: number } | undefined
  private versionReportInFlight: { generation: number; key: string; promise: Promise<SkillVersionReport> } | undefined
  private versionReportCacheGeneration = 0
  private inventoryInFlight: { promise: Promise<SkillInventory>; writeManifest: boolean } | undefined
  private inventoryChangeTimer: NodeJS.Timeout | undefined
  private readonly unsubscribeAuthStateChanged: () => void
  private isDisposed = false
  public readonly cliChanged = new ServiceEvent<SkillCliChangedEvent>()
  public readonly inventoryChanged = new ServiceEvent<SkillInventoryChangedEvent>()

  public constructor(authService: AuthManager) {
    super(SkillServiceName)
    this.authService = authService
    this.unsubscribeAuthStateChanged = this.authService.stateChanged.on(() => {
      this.invalidateShareInfoCache()
      this.invalidateMyPublishedSkillCatalog()
      this.invalidateVersionReport()
    })
    if (app.isReady()) {
      this.startWatching()
    } else {
      void app.whenReady().then(() => {
        if (!this.isDisposed) {
          this.startWatching()
        }
      })
    }
  }

  private getManifestPath(): string {
    return path.join(app.getPath("userData"), "skills", "manifest.json")
  }

  private async runOoCommand(
    args: string[],
    options: Omit<Parameters<typeof runOoCommand>[1], "env">,
  ): Promise<OoCommandResult> {
    await this.authService.getAuthState()
    const account = this.authService.getCurrentAuthSecret()

    if (!account) {
      throw new Error("Skills not available (sign in first)")
    }

    return runOoCommand(args, {
      ...options,
      env: buildOoEnv({
        apiKey: account.apiKey,
        storeDir: path.join(app.getPath("userData"), "agent", "oo-store"),
        ooBinPath: process.env["OO_CLI_PATH"],
      }),
    })
  }

  public async getSkillInventory(): Promise<SkillInventory> {
    return this.readSharedSkillInventory({ writeManifest: true })
  }

  public async checkSkillInventory(): Promise<SkillInventory> {
    const inventory = await this.readSharedSkillInventory({ writeManifest: true })
    await this.emitInventoryChanged()
    return inventory
  }

  public async executeSkillRepairPlan(request: ExecuteSkillRepairPlanRequest): Promise<SkillRepairExecutionResult> {
    const startedAt = Date.now()
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const plan = buildSkillRepairPlan(inventory.groups, request)
    const historyArgs = ["skills", "repair", request.kind, request.skillId, request.agentId ?? "all"]

    if (request.confirmedPlanId !== plan.id) {
      throw new Error("Confirmed repair plan does not match the current repair plan.")
    }

    if (plan.status !== "ready") {
      return {
        affectedTargets: 0,
        plan,
        status: "not-needed",
      }
    }

    if (plan.kind !== "reset") {
      return {
        affectedTargets: 0,
        plan,
        status: "unsupported",
      }
    }

    try {
      await resetSkillTargets(plan.targets)
      await this.refreshManifestRecordsForTargets(plan.targets.map((target) => target.currentPath))
      await recordOperationHistory({
        args: historyArgs,
        command: "oo-desktop",
        durationMs: Date.now() - startedAt,
        ok: true,
        owner: "skill-service",
        stdout: `Reset ${plan.targets.length} skill copies for ${plan.skillName}.`,
      })

      return {
        affectedTargets: plan.targets.length,
        plan,
        status: "succeeded",
      }
    } catch (cause) {
      await recordOperationHistory({
        args: historyArgs,
        command: "oo-desktop",
        durationMs: Date.now() - startedAt,
        ok: false,
        owner: "skill-service",
        stderr: cause instanceof Error ? cause.message : String(cause),
      })
      throw cause
    }
  }

  public async getSkillRepairPlan(request: SkillRepairPlanRequest): Promise<SkillRepairPlan> {
    const inventory = await this.readSkillInventory({ writeManifest: false })
    return buildSkillRepairPlan(inventory.groups, request)
  }

  public async getSkillSummary(): Promise<SkillSummary> {
    return (await this.getSkillInventory()).summary
  }

  public async searchRegistrySkills(request: { query: string }) {
    const result = await this.runOoCommand(createSkillSearchArgs(request.query), {
      owner: "skill-service",
    })

    return normalizeSkillSearchResults(result.stdout)
  }

  public async listMyPublishedSkills(request: ListMyPublishedSkillsRequest = {}): Promise<MyPublishedSkillCatalog> {
    await this.authService.getAuthState()
    const account = this.authService.getCurrentAuthSecret()

    if (!account) {
      return {
        items: [],
        next: null,
        updatedAt: new Date().toISOString(),
      }
    }

    const query = request.query?.trim() ?? ""
    const next = request.next?.trim() ?? ""
    const cacheKey = `${account.id}@${ooEndpoint}:${query}:${next}`
    const cacheGeneration = this.myPublishedSkillCatalogCacheGeneration
    const cached = this.myPublishedSkillCatalogCacheByKey.get(cacheKey)

    if (!request.forceRefresh && cached && Date.now() - cached.time < myPublishedSkillCatalogCacheTtlMs) {
      return cached.catalog
    }

    const inFlight = this.myPublishedSkillCatalogInFlightByKey.get(cacheKey)
    if (!request.forceRefresh && inFlight) {
      return inFlight
    }

    const promise = this.readMyPublishedSkillCatalog({
      apiKey: account.apiKey,
      endpoint: ooEndpoint,
      next,
      query,
    })
      .then((catalog) => {
        if (cacheGeneration === this.myPublishedSkillCatalogCacheGeneration) {
          this.myPublishedSkillCatalogCacheByKey.set(cacheKey, { catalog, time: Date.now() })
        }
        return catalog
      })
      .finally(() => {
        this.myPublishedSkillCatalogInFlightByKey.delete(cacheKey)
      })

    this.myPublishedSkillCatalogInFlightByKey.set(cacheKey, promise)
    return promise
  }

  public async installBuiltInSkill(request: InstallBuiltInSkillRequest): Promise<SkillInventory> {
    if (!builtInSkillIds.includes(request.skillId)) {
      throw new Error(`Unsupported built-in skill: ${request.skillId}`)
    }

    await this.runOoCommand(["skills", "add", request.skillId], {
      owner: "skill-service",
    })

    return this.readAndPublishSkillInventory()
  }

  public async enableSkillForAllAgents(request: EnableSkillForAllAgentsRequest): Promise<SkillInventory> {
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const group = inventory.groups.find((item) => item.id === request.skillId)

    if (!group) {
      throw new Error(`Skill is not installed: ${request.skillId}`)
    }

    if (!group.hosts.some((host) => host.status === "missing")) {
      return inventory
    }

    if (group.isBuiltIn) {
      if (!builtInSkillIds.includes(group.id as (typeof builtInSkillIds)[number])) {
        throw new Error(`Unsupported built-in skill: ${group.id}`)
      }

      return this.installBuiltInSkill({ skillId: group.id as (typeof builtInSkillIds)[number] })
    }

    const packageName = group.packageName?.trim()
    if (group.kind === "registry" && packageName) {
      return this.installRegistrySkill({ packageName, skillId: group.id })
    }

    if (group.kind === "local") {
      const plan = await this.getSkillEnablePlan(request)
      if (plan.status === "not-needed") {
        return inventory
      }

      if (plan.status !== "ready") {
        throw new Error("This Skill cannot be enabled for all agents automatically.")
      }

      if (plan.requiresConfirmation && request.confirmedPlanId !== plan.id) {
        throw new Error("Enabling this local Skill requires confirmation.")
      }

      await copyLocalSkillEnablePlanTargets(plan)
      return this.readAndPublishSkillInventory()
    }

    throw new Error("Only built-in, published, and local Skills can be enabled for all agents automatically.")
  }

  public async getSkillEnablePlan(request: SkillEnablePlanRequest): Promise<SkillEnablePlan> {
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const group = inventory.groups.find((item) => item.id === request.skillId)

    if (!group) {
      throw new Error(`Skill is not installed: ${request.skillId}`)
    }

    if (group.kind !== "local") {
      return {
        id: createSkillEnablePlanId({
          skillId: group.id,
          sourceAgentId: request.sourceAgentId,
          targets: [],
        }),
        requiresConfirmation: false,
        skillId: group.id,
        skillName: group.name,
        status: getMissingHostCount(group) > 0 ? "unsupported" : "not-needed",
        targets: [],
      }
    }

    const sourceHost =
      group.hosts.find((host) => host.status === "installed" && host.agentId === request.sourceAgentId && host.path) ??
      group.hosts.find((host) => host.status === "installed" && host.controlState === "controlled" && host.path) ??
      group.hosts.find((host) => host.status === "installed" && host.path)

    if (!sourceHost?.path) {
      return {
        id: createSkillEnablePlanId({ skillId: group.id, sourceAgentId: request.sourceAgentId, targets: [] }),
        requiresConfirmation: false,
        skillId: group.id,
        skillName: group.name,
        status: "unsupported",
        targets: [],
      }
    }

    const agents = await listDiscoveredAgents()
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
    const targets = await Promise.all(
      group.hosts
        .filter((host) => host.status === "missing")
        .map(async (host) => {
          const agent = agentsById.get(host.agentId)
          if (!agent) {
            return undefined
          }

          const targetPath = resolveSkillTargetPath(agent, group.id)
          return {
            action: (await localPathExists(targetPath)) ? ("overwrite" as const) : ("create" as const),
            agentId: host.agentId,
            agentName: host.agentName,
            path: targetPath,
          }
        }),
    )
    const enabledTargets = targets.filter((target): target is NonNullable<(typeof targets)[number]> => Boolean(target))

    return {
      id: createSkillEnablePlanId({
        skillId: group.id,
        sourceAgentId: sourceHost.agentId,
        targets: enabledTargets,
      }),
      requiresConfirmation: enabledTargets.some((target) => target.action === "overwrite"),
      skillId: group.id,
      skillName: group.name,
      sourceAgentId: sourceHost.agentId,
      sourceAgentName: sourceHost.agentName,
      sourcePath: sourceHost.path,
      status: enabledTargets.length > 0 ? "ready" : "not-needed",
      targets: enabledTargets,
    }
  }

  public async installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory> {
    const result = await this.runOoCommand(createInstallRegistrySkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return this.readAndPublishSkillInventory()
  }

  public async replaceConflictingRegistrySkill(
    request: ReplaceConflictingRegistrySkillRequest,
  ): Promise<SkillInventory> {
    if (!request.confirmed) {
      throw new Error("Replacing a local Skill with a registry Skill requires confirmation.")
    }

    const inventory = await this.readSkillInventory({ writeManifest: false })
    const installState = resolveMyPublishedSkillInstallState(inventory, request)
    if (installState.installState !== "name-conflict") {
      throw new Error("No same-name local Skill conflict was found.")
    }

    const result = await this.runOoCommand(createInstallRegistrySkillArgs({ ...request, force: true }), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return this.readAndPublishSkillInventory()
  }

  public async updateRegistrySkill(request: UpdateRegistrySkillRequest): Promise<SkillInventory> {
    const result = await this.runOoCommand(createUpdateRegistrySkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.update")
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return this.readAndPublishSkillInventory()
  }

  public async executeRegistrySkillUpdate(request: ExecuteSkillUpdateRequest): Promise<SkillVersionReport> {
    await this.updateRegistrySkill(request)
    return this.checkSkillVersions({ forceRefresh: true })
  }

  public async executeCliUpdate(): Promise<SkillVersionReport> {
    await this.runOoCommand(createCliUpdateArgs(), {
      owner: "skill-service",
    })
    this.invalidateVersionReport()
    this.emitCliChanged()
    await this.emitInventoryChanged()
    return this.checkSkillVersions({ forceRefresh: true })
  }

  public async syncRegistrySkills(request: SyncRegistrySkillsRequest): Promise<SyncRegistrySkillsResult> {
    const result = await this.runOoCommand(createSkillSyncArgs(request.direction), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, `skills.sync.${request.direction}`)
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return {
      direction: request.direction,
      inventory: await this.readAndPublishSkillInventory(),
    }
  }

  public async openSkillFolder(request: OpenSkillPathRequest): Promise<void> {
    const skillPath = await this.resolveAllowedSkillPath(request.path)
    const error = await shell.openPath(skillPath)

    if (error) {
      throw new Error(error)
    }
  }

  public async openSkillInEditor(request: OpenSkillInEditorRequest): Promise<void> {
    const skillPath = await this.resolveAllowedSkillPath(request.path)
    if (request.editorId === "system") {
      await this.openSkillFolder({ path: skillPath })
      return
    }

    const editor = await resolveEditorCommand({ editorId: request.editorId })

    if (!editor) {
      await this.openSkillFolder({ path: skillPath })
      return
    }

    try {
      await launchEditorCommand(editor, skillPath)
    } catch {
      await this.openSkillFolder({ path: skillPath })
    }
  }

  public async listSkillEditors(): Promise<SkillEditorApp[]> {
    return listSkillEditorApps()
  }

  public async publishSkill(request: PublishSkillRequest): Promise<PublishSkillResult> {
    const result = await this.runOoCommand(createPublishSkillArgs(request), {
      owner: "skill-service",
    })
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return {
      inventory: await this.readAndPublishSkillInventory(),
      message: result.stdout.trim(),
    }
  }

  public async adoptLocalSkillProject(request: AdoptLocalSkillProjectRequest): Promise<AdoptLocalSkillProjectResult> {
    const skillPath = await this.resolveAllowedSkillPath(request.path)
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const project = inventory.localProjects.find((item) => {
      return (
        path.resolve(item.path) === skillPath && (request.agentId === undefined || item.agentId === request.agentId)
      )
    })

    if (!project) {
      throw new Error("Local Skill project was not found.")
    }

    const agent = supportedAgents.find((item) => item.id === project.agentId)
    if (!agent) {
      throw new Error(`Unsupported Skill agent: ${project.agentName}`)
    }

    const skillId = request.name?.trim() || project.name
    const result = await this.runOoCommand(
      createAdoptLocalSkillArgs({
        agent: agent.ooCliAgentId,
        description: request.description,
        icon: request.icon,
        name: request.name,
        path: skillPath,
        title: request.title,
      }),
      {
        owner: "skill-service",
      },
    )
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return {
      inventory: await this.readAndPublishSkillInventory(),
      message: result.stdout.trim(),
      skillId,
    }
  }

  public async getSkillShareInfo(request: SkillShareInfoRequest): Promise<SkillShareInfo> {
    const packageName = request.packageName?.trim()

    if (!packageName) {
      return {
        limitsRequired: false,
        visibility: "unpublished",
      }
    }

    try {
      await this.authService.getAuthState()
      const account = this.authService.getCurrentAuthSecret()

      if (!account) {
        return {
          limitsRequired: false,
          packageName,
          visibility: "unpublished",
        }
      }

      const cacheKey = `${ooEndpoint}:${packageName}`
      const cached = this.shareInfoCacheByKey.get(cacheKey)
      if (cached && Date.now() - cached.time < skillShareInfoCacheTtlMs) {
        return cached.info
      }

      const inFlight = this.shareInfoInFlightByKey.get(cacheKey)
      if (inFlight) {
        return inFlight
      }

      const cacheGeneration = this.shareInfoCacheGeneration
      const request = readRegistrySkillShareInfo({
        apiKey: account.apiKey,
        endpoint: ooEndpoint,
        packageName,
      })
        .then((info) => {
          const nextInfo = {
            ...info,
            packageName: info.packageName ?? packageName,
          }
          if (cacheGeneration === this.shareInfoCacheGeneration) {
            this.shareInfoCacheByKey.set(cacheKey, { info: nextInfo, time: Date.now() })
          }
          return nextInfo
        })
        .finally(() => {
          this.shareInfoInFlightByKey.delete(cacheKey)
        })

      this.shareInfoInFlightByKey.set(cacheKey, request)
      return request
    } catch {
      return {
        limitsRequired: false,
        packageName,
        visibility: "unpublished",
      }
    }
  }

  public async shareSkill(request: ShareSkillRequest) {
    const result = await this.runOoCommand(createShareSkillArgs(request), {
      owner: "skill-service",
    })

    return normalizeSkillShareResult(result.stdout)
  }

  public async deleteSkill(request: DeleteSkillRequest): Promise<SkillInventory> {
    if (!request.confirmed) {
      throw new Error("Skill deletion requires confirmation.")
    }

    const result = await this.runOoCommand(createDeleteSkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.uninstall")
    this.invalidateShareInfoCache()
    this.invalidateMyPublishedSkillCatalog()

    return this.readAndPublishSkillInventory()
  }

  public async checkSkillVersions(request: CheckSkillVersionsRequest = {}): Promise<SkillVersionReport> {
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const authSnapshot = await this.readAuthSnapshot()
    const cacheKey = `${authSnapshot.cacheKey}:${createVersionReportCacheKey(inventory)}`
    const cacheGeneration = this.versionReportCacheGeneration
    const now = Date.now()

    if (
      !request.forceRefresh &&
      this.versionReportCache?.key === cacheKey &&
      this.versionReportCache.generation === cacheGeneration &&
      now - this.versionReportCache.time < 30 * 60_000
    ) {
      return this.versionReportCache.report
    }

    if (this.versionReportInFlight?.key === cacheKey && this.versionReportInFlight.generation === cacheGeneration) {
      return this.versionReportInFlight.promise
    }

    const promise = this.readSkillVersionReport(inventory, authSnapshot)
    this.versionReportInFlight = { generation: cacheGeneration, key: cacheKey, promise }

    try {
      const report = await promise

      if (!this.isCurrentVersionReportRequest(cacheKey, cacheGeneration, promise)) {
        return this.checkSkillVersions()
      }

      this.versionReportCache = {
        generation: cacheGeneration,
        key: cacheKey,
        report,
        time: Date.now(),
      }

      return report
    } finally {
      if (this.versionReportInFlight?.promise === promise) {
        this.versionReportInFlight = undefined
      }
    }
  }

  public override dispose(): void {
    this.isDisposed = true

    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers.length = 0

    if (this.inventoryChangeTimer) {
      clearTimeout(this.inventoryChangeTimer)
      this.inventoryChangeTimer = undefined
    }

    this.unsubscribeAuthStateChanged()
    super.dispose()
  }

  private startWatching(): void {
    if (this.watchers.length > 0 || this.isDisposed) {
      return
    }

    const watchedPaths = new Set([
      path.dirname(this.getManifestPath()),
      path.join(resolveOoStoreDirectory(), "skills"),
      ...supportedAgents.map((agent) => resolveAgentSkillRoot(agent)),
    ])
    const recursive = process.platform === "darwin" || process.platform === "win32"

    for (const pathname of watchedPaths) {
      try {
        this.watchers.push(
          watch(pathname, { persistent: false, recursive }, () => {
            this.scheduleInventoryChanged()
          }),
        )
        logDiagnosticOnChange(`skill-service:watch:${pathname}`, "skill-service", "watching skill path", {
          pathname,
          recursive,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isMissing = message.includes("ENOENT")
        logDiagnosticOnChange(
          `skill-service:watch:${pathname}`,
          "skill-service",
          "failed to watch skill path",
          { error: message, pathname, recursive },
          isMissing ? "trace" : "warn",
          isMissing ? { missing: true, pathname, recursive } : { error: message, pathname, recursive },
        )
        // 目录可能尚不存在；focus/background refresh 仍会兜底发现后续变化。
      }
    }
  }

  private scheduleInventoryChanged(): void {
    this.invalidateVersionReport()
    this.invalidateMyPublishedSkillCatalog()
    if (this.inventoryChangeTimer) {
      clearTimeout(this.inventoryChangeTimer)
    }

    this.inventoryChangeTimer = setTimeout(() => {
      this.inventoryChangeTimer = undefined
      void this.emitInventoryChanged()
    }, 300)
    this.inventoryChangeTimer.unref()
  }

  private async emitInventoryChanged(): Promise<void> {
    const event: SkillInventoryChangedEvent = {
      updatedAt: new Date().toISOString(),
    }

    this.inventoryChanged.emit(event)
    await this.send("skillInventoryChanged", event)
  }

  private emitCliChanged(): void {
    this.cliChanged.emit({
      updatedAt: new Date().toISOString(),
    })
  }

  private async refreshManifestRecordsForTargets(targetPaths: string[]): Promise<void> {
    const manifestPath = this.getManifestPath()
    const [installedSkills, manifestStore] = await Promise.all([scanInstalledSkills(), readManifestStore(manifestPath)])
    const targetPathSet = new Set(targetPaths)
    const targetSkills = installedSkills.filter((skill) => targetPathSet.has(skill.path))
    await writeManifestStore(manifestPath, replaceManifestRecords(manifestStore, targetSkills))
  }

  private invalidateVersionReport(): void {
    this.versionReportCacheGeneration += 1
    this.versionReportCache = undefined
    this.versionReportInFlight = undefined
  }

  private isCurrentVersionReportRequest(
    cacheKey: string,
    cacheGeneration: number,
    promise: Promise<SkillVersionReport>,
  ): boolean {
    return (
      this.versionReportCacheGeneration === cacheGeneration &&
      this.versionReportInFlight?.key === cacheKey &&
      this.versionReportInFlight.generation === cacheGeneration &&
      this.versionReportInFlight.promise === promise
    )
  }

  private async readAndPublishSkillInventory(): Promise<SkillInventory> {
    this.invalidateVersionReport()
    this.invalidateMyPublishedSkillCatalog()
    const inventory = await this.readSkillInventory({ writeManifest: true })
    await this.emitInventoryChanged()
    return inventory
  }

  private async readSharedSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    if (this.inventoryInFlight && (!options.writeManifest || this.inventoryInFlight.writeManifest)) {
      return this.inventoryInFlight.promise
    }

    const promise = this.readSkillInventory(options)
    this.inventoryInFlight = {
      promise,
      writeManifest: options.writeManifest,
    }

    try {
      return await promise
    } finally {
      if (this.inventoryInFlight?.promise === promise) {
        this.inventoryInFlight = undefined
      }
    }
  }

  private async readCliVersionCheck(currentVersion?: string): Promise<SkillCliVersionCheck> {
    const result = await this.runOoCommand(createCliCheckUpdateArgs(), {
      owner: "skill-service",
      rejectOnFailure: false,
    })

    if (!result.ok) {
      return {
        command: createCliCheckUpdateArgs(),
        currentVersion,
        error: result.message ?? result.stderr,
        raw: result.stdout || result.stderr,
        status: "failed" as const,
      }
    }

    try {
      return normalizeCliCheckUpdateResult(result.stdout, currentVersion)
    } catch (cause) {
      return {
        command: createCliCheckUpdateArgs(),
        currentVersion,
        error: cause instanceof Error ? cause.message : String(cause),
        raw: result.stdout || result.stderr,
        status: "failed",
      }
    }
  }

  private async readSkillVersionReport(
    inventory: SkillInventory,
    authSnapshot: SkillVersionAuthSnapshot,
  ): Promise<SkillVersionReport> {
    const installedGroups = inventory.groups.filter((group) => group.hosts.some((host) => host.status === "installed"))
    const shouldCheckRegistrySkills = installedGroups.some(
      (group) => group.kind === "registry" && Boolean(group.packageName),
    )
    const publishedLocalGroups = installedGroups.filter((group) => group.kind === "local" && Boolean(group.packageName))
    const registryCheckCommand = createRegistrySkillCheckUpdateArgs()
    const currentCliVersion = await readCurrentOoCliVersion((args, options) => this.runOoCommand(args, options))
    const [cli, registryChecksResult, publishedLocalChecks] = await Promise.all([
      this.readCliVersionCheck(currentCliVersion),
      shouldCheckRegistrySkills
        ? this.readRegistrySkillVersionChecks()
        : Promise.resolve({
            ok: true as const,
            command: registryCheckCommand,
            results: [] as ReturnType<typeof normalizeRegistrySkillCheckUpdateResults>,
          }),
      this.readPublishedLocalSkillVersionChecks(publishedLocalGroups, authSnapshot.account),
    ])
    const checks = await Promise.all(
      installedGroups.map(async (group) => {
        if (group.kind === "registry") {
          if (!group.packageName) {
            return createFailedSkillVersionCheck(group, "Registry Skill is missing packageName.")
          }

          if (!registryChecksResult.ok) {
            return createFailedRegistrySkillVersionCheck(
              group,
              registryChecksResult.error,
              registryChecksResult.command,
            )
          }

          return createRegistrySkillVersionCheckFromUpdateResult(
            group,
            registryChecksResult.results,
            registryChecksResult.command,
          )
        }

        if (group.kind === "bundled") {
          return createBundledSkillVersionCheck(group, cli)
        }

        if (group.kind === "local" && group.packageName) {
          const packageName = group.packageName.trim()

          return (
            publishedLocalChecks.get(createPublishedLocalSkillVersionCheckKey(group.id, packageName)) ?? {
              currentVersion: group.version,
              id: group.id,
              kind: group.kind,
              name: group.name,
              packageName,
              skillId: group.id,
              status: "not-checkable" as const,
            }
          )
        }

        return {
          currentVersion: group.version,
          id: group.id,
          kind: group.kind,
          name: group.name,
          packageName: group.packageName,
          skillId: group.id,
          status: "not-checkable" as const,
        }
      }),
    )
    const summary = {
      bundledSkillUpdates: checks.filter((check) => check.kind === "bundled" && check.status === "update-available")
        .length,
      cliUpdates: cli.status === "update-available" ? 1 : 0,
      errors: checks.filter((check) => check.status === "failed").length + (cli.status === "failed" ? 1 : 0),
      registrySkillUpdates: checks.filter((check) => check.kind === "registry" && check.status === "update-available")
        .length,
      totalUpdates: 0,
    }
    summary.totalUpdates = summary.bundledSkillUpdates + summary.cliUpdates + summary.registrySkillUpdates
    const report: SkillVersionReport = {
      checkedAt: new Date().toISOString(),
      cli,
      skills: checks,
      summary,
    }

    return report
  }

  private async readMyPublishedSkillCatalog(request: {
    apiKey: string
    endpoint: string
    next?: string
    query?: string
  }): Promise<MyPublishedSkillCatalog> {
    const [packageList, inventory] = await Promise.all([
      readMyPublishedPackageList(request),
      this.readSkillInventory({ writeManifest: false }),
    ])
    const packageInfos = await Promise.all(
      packageList.packages.map(async (publishedPackage) => {
        const info = await readRegistryPackageSkillInfoForCatalog({
          apiKey: request.apiKey,
          endpoint: request.endpoint,
          packageName: publishedPackage.name,
        })

        return info ? { info, publishedPackage } : undefined
      }),
    )
    const items: MyPublishedSkill[] = []

    for (const entry of packageInfos) {
      if (!entry) {
        continue
      }

      const { info, publishedPackage } = entry
      for (const skill of info.skills) {
        const installState = resolveMyPublishedSkillInstallState(inventory, {
          packageName: info.packageName,
          skillId: skill.name,
        })
        const visibility = info.visibility === "unknown" ? publishedPackage.visibility : info.visibility

        const item: MyPublishedSkill = {
          description: skill.description ?? info.description ?? publishedPackage.description,
          displayName: skill.displayName,
          icon: info.icon ?? publishedPackage.icon,
          id: createPublishedSkillKey(info.packageName, skill.name),
          installed: installState.installed,
          installState: installState.installState,
          packageName: info.packageName,
          packageVersion: info.packageVersion,
          skillId: skill.name,
          updateTime: publishedPackage.updateTime,
          visibility,
        }
        if (installState.conflictingSkill) {
          item.conflictingSkill = installState.conflictingSkill
        }
        if (installState.installedVersion) {
          item.installedVersion = installState.installedVersion
        }

        items.push(item)
      }
    }

    return {
      items: items.sort(compareMyPublishedSkills),
      next: packageList.next,
      updatedAt: new Date().toISOString(),
    }
  }

  private async readRegistrySkillVersionChecks(): Promise<
    | { ok: true; command: string[]; results: ReturnType<typeof normalizeRegistrySkillCheckUpdateResults> }
    | { ok: false; command: string[]; error: string }
  > {
    const command = createRegistrySkillCheckUpdateArgs()
    const result = await this.runOoCommand(command, {
      owner: "skill-service",
      rejectOnFailure: false,
    })

    if (!result.ok) {
      return { ok: false, command, error: result.message ?? result.stderr }
    }

    try {
      return { ok: true, command, results: normalizeRegistrySkillCheckUpdateResults(result.stdout) }
    } catch (cause) {
      return { ok: false, command, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  private async readPublishedLocalSkillVersionChecks(
    groups: readonly SkillInventory["groups"][number][],
    account: AuthAccountSecret,
  ): Promise<Map<string, SkillPackageVersionCheck>> {
    const checks = new Map<string, SkillPackageVersionCheck>()

    if (groups.length === 0) {
      return checks
    }

    if (!account) {
      return checks
    }

    const packageInfoByName = new Map<string, ReturnType<typeof readRegistrySkillPackageVersionInfo>>()

    const readPackageInfo = (packageName: string) => {
      const existing = packageInfoByName.get(packageName)

      if (existing) {
        return existing
      }

      const request = readRegistrySkillPackageVersionInfo({
        apiKey: account.apiKey,
        endpoint: ooEndpoint,
        packageName,
      })
      packageInfoByName.set(packageName, request)
      return request
    }

    await Promise.all(
      groups.map(async (group) => {
        const packageName = group.packageName?.trim()

        if (!packageName) {
          return
        }

        const command = createRegistryPackageInfoVersionCheckCommand(packageName)
        try {
          const info = await readPackageInfo(packageName)
          checks.set(
            createPublishedLocalSkillVersionCheckKey(group.id, packageName),
            createPublishedSkillVersionCheckFromPackageInfo(group, info, command),
          )
        } catch (cause) {
          checks.set(createPublishedLocalSkillVersionCheckKey(group.id, packageName), {
            command,
            currentVersion: group.version,
            error: cause instanceof Error ? cause.message : String(cause),
            id: group.id,
            kind: group.kind,
            name: group.name,
            packageName,
            skillId: group.id,
            status: "failed",
          })
        }
      }),
    )

    return checks
  }

  private async readSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    const startedAtMs = Date.now()
    const manifestPath = this.getManifestPath()
    const targetAgents = await listDiscoveredAgents()
    const [installedSkills, localProjects, manifestStore] = await Promise.all([
      scanInstalledSkills(targetAgents),
      scanLocalSkillProjects(targetAgents),
      readManifestStore(manifestPath),
    ])
    const nextManifestStore = upsertManifestRecords(manifestStore, installedSkills)
    const groups = groupInstalledSkills(installedSkills, nextManifestStore)

    if (options.writeManifest && !areManifestStoresEqual(manifestStore, nextManifestStore)) {
      await writeManifestStore(manifestPath, nextManifestStore)
    }

    const inventory = {
      groups,
      localProjects,
      summary: buildSummary(groups, localProjects),
      updatedAt: new Date().toISOString(),
    }
    const diagnosticFields = {
      durationMs: Date.now() - startedAtMs,
      groupCount: inventory.groups.length,
      installedSkillCount: installedSkills.length,
      localProjectCount: inventory.localProjects.length,
      managedSkillCount: inventory.summary.managedSkills,
      manifestPath,
      needsAttention: inventory.summary.needsAttention,
      registrySkillCount: inventory.summary.registrySkills,
      writeManifest: options.writeManifest,
    }
    logDiagnosticOnChange(
      "skill-service:inventory",
      "skill-service",
      "skill inventory read",
      diagnosticFields,
      "trace",
      {
        groupCount: diagnosticFields.groupCount,
        installedSkillCount: diagnosticFields.installedSkillCount,
        localProjectCount: diagnosticFields.localProjectCount,
        managedSkillCount: diagnosticFields.managedSkillCount,
        manifestPath: diagnosticFields.manifestPath,
        needsAttention: diagnosticFields.needsAttention,
        registrySkillCount: diagnosticFields.registrySkillCount,
      },
    )
    return inventory
  }

  private async resolveAllowedSkillPath(requestPath: string): Promise<string> {
    const resolvedRequestPath = path.resolve(requestPath)
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const allowedPaths = [
      ...inventory.localProjects.map((project) => project.path),
      ...inventory.groups.flatMap((group) => group.hosts.flatMap((host) => [host.path, host.sourcePath])),
    ]

    for (const allowedPath of allowedPaths) {
      if (!allowedPath) {
        continue
      }

      const resolvedAllowedPath = path.resolve(allowedPath)
      if (
        resolvedRequestPath === resolvedAllowedPath ||
        resolvedRequestPath.startsWith(`${resolvedAllowedPath}${path.sep}`)
      ) {
        await access(resolvedRequestPath)
        return resolvedRequestPath
      }
    }

    throw new Error("Skill path is not allowed.")
  }

  private invalidateShareInfoCache(): void {
    this.shareInfoCacheGeneration += 1
    this.shareInfoCacheByKey.clear()
    this.shareInfoInFlightByKey.clear()
  }

  private invalidateMyPublishedSkillCatalog(): void {
    this.myPublishedSkillCatalogCacheGeneration += 1
    this.myPublishedSkillCatalogCacheByKey.clear()
    this.myPublishedSkillCatalogInFlightByKey.clear()
  }

  private async readAuthSnapshot(): Promise<SkillVersionAuthSnapshot> {
    await this.authService.getAuthState()
    const account = this.authService.getCurrentAuthSecret()

    if (!account) {
      return {
        account,
        cacheKey: "signed-out",
      }
    }

    return {
      account,
      cacheKey: `${account.id}@${ooEndpoint}`,
    }
  }
}

async function readRegistrySkillShareInfo(request: {
  apiKey: string
  endpoint: string
  packageName: string
}): Promise<SkillShareInfo> {
  const url = new URL(`/-/oomol/package-info/${encodeURIComponent(request.packageName)}/latest`, registryBaseUrl)
  url.searchParams.set("lang", "en")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: request.apiKey,
      },
    })

    if (response.status === 404) {
      return {
        limitsRequired: false,
        packageName: request.packageName,
        visibility: "unpublished",
      }
    }

    if (!response.ok) {
      throw new Error(`Package info request failed with status ${response.status}.`)
    }

    return normalizeSkillShareInfo(await response.text())
  } finally {
    clearTimeout(timeout)
  }
}

async function readRegistrySkillPackageVersionInfo(request: {
  apiKey: string
  endpoint: string
  packageName: string
}): Promise<ReturnType<typeof normalizeRegistryPackageVersionInfo> | undefined> {
  const url = new URL(`/-/oomol/package-info/${encodeURIComponent(request.packageName)}/latest`, registryBaseUrl)
  url.searchParams.set("lang", "en")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: request.apiKey,
      },
    })

    if (response.status === 404) {
      return undefined
    }

    if (!response.ok) {
      throw new Error(`Package info request failed with status ${response.status}.`)
    }

    return normalizeRegistryPackageVersionInfo(await response.text())
  } finally {
    clearTimeout(timeout)
  }
}

async function readMyPublishedPackageList(request: {
  apiKey: string
  endpoint: string
  next?: string
  query?: string
}): Promise<ReturnType<typeof normalizeMyPublishedPackageList>> {
  const url = new URL("/v1/packages/-/my", searchBaseUrl)
  url.searchParams.set("size", "80")
  url.searchParams.set("lang", "en")

  if (request.query) {
    url.searchParams.set("q", request.query)
  }

  if (request.next) {
    url.searchParams.set("next", request.next)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: request.apiKey,
      },
    })

    if (!response.ok) {
      throw new Error(`Published package list request failed with status ${response.status}.`)
    }

    return normalizeMyPublishedPackageList(await response.text())
  } finally {
    clearTimeout(timeout)
  }
}

async function readRegistryPackageSkillInfoForCatalog(request: {
  apiKey: string
  endpoint: string
  packageName: string
}): Promise<ReturnType<typeof normalizeRegistryPackageSkillInfo> | undefined> {
  const url = new URL(`/-/oomol/package-info/${encodeURIComponent(request.packageName)}/latest`, registryBaseUrl)
  url.searchParams.set("lang", "en")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: request.apiKey,
      },
    })

    if (response.status === 404) {
      return undefined
    }

    if (!response.ok) {
      throw new Error(`Package info request failed with status ${response.status}.`)
    }

    return normalizeRegistryPackageSkillInfo(await response.text())
  } finally {
    clearTimeout(timeout)
  }
}

async function readCurrentOoCliVersion(runCommand: RunSkillOoCommand): Promise<string | undefined> {
  const result = await runCommand(["version", "--json"], {
    owner: "skill-service",
    rejectOnFailure: false,
  })

  if (!result.ok) {
    return undefined
  }

  return normalizeOoCliVersion(result.stdout || result.stderr)
}

function assertOoSkillOperationResult(
  result: OoCommandResult,
  expectedCommand: Parameters<typeof assertSkillOperationSucceeded>[1],
): void {
  if (!result.ok && !result.stdout.trim()) {
    throw new Error(result.message ?? (result.stderr || "Skill operation failed."))
  }

  try {
    assertSkillOperationSucceeded(result.stdout, expectedCommand)
  } catch (cause) {
    if (!result.ok && cause instanceof SyntaxError) {
      throw new Error(result.message ?? (result.stderr || "Skill operation failed."))
    }

    throw cause
  }
}

function createVersionReportCacheKey(inventory: SkillInventory): string {
  return inventory.groups
    .flatMap((group) => {
      return group.hosts.map((host) => {
        return [
          group.id,
          group.kind,
          group.packageName ?? "",
          group.version ?? "",
          host.agentId,
          host.status,
          host.controlState ?? "",
          host.version ?? "",
        ].join(":")
      })
    })
    .sort()
    .join("|")
}

function getMissingHostCount(group: Pick<SkillInventory["groups"][number], "hosts">): number {
  return group.hosts.filter((host) => host.status === "missing").length
}

async function localPathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

function resolveSkillTargetPath(
  agent: Awaited<ReturnType<typeof listDiscoveredAgents>>[number],
  skillId: string,
): string {
  if (skillId.includes("/") || skillId.includes("\\") || skillId === "." || skillId === "..") {
    throw new Error(`Invalid skill name: ${skillId}`)
  }

  return path.join(resolveAgentSkillRoot(agent), skillId)
}

function createSkillEnablePlanId(request: {
  skillId: string
  sourceAgentId?: string
  targets: readonly SkillEnablePlan["targets"][number][]
}): string {
  const targetSignature = request.targets
    .map((target) => [target.agentId, target.action, target.path ?? ""].join(":"))
    .sort()
    .join("|")

  return ["enable-skill", request.skillId, request.sourceAgentId ?? "", targetSignature].join("::")
}

async function copyLocalSkillEnablePlanTargets(plan: SkillEnablePlan): Promise<void> {
  if (!plan.sourcePath) {
    throw new Error("Local Skill source path is missing.")
  }

  const sourceStat = await stat(plan.sourcePath)
  if (!sourceStat.isDirectory()) {
    throw new Error(`Skill source is not a directory: ${plan.sourcePath}`)
  }

  for (const target of plan.targets) {
    if (!target.path) {
      throw new Error(`Skill target path is missing for ${target.agentName}.`)
    }

    assertSafeResetPaths(plan.sourcePath, target.path)
    const targetExists = await localPathExists(target.path)
    if (targetExists && target.action !== "overwrite") {
      throw new Error(`Skill target already exists for ${target.agentName}. Refresh and confirm the copy plan.`)
    }

    await mkdir(path.dirname(target.path), { recursive: true })
    if (target.action === "overwrite") {
      await rm(target.path, { force: true, recursive: true })
    }
    await cp(plan.sourcePath, target.path, { recursive: true })
  }
}

function createPublishedLocalSkillVersionCheckKey(skillId: string, packageName: string): string {
  return `${skillId}:${packageName}`
}

function createPublishedSkillKey(packageName: string, skillId: string): string {
  return `${packageName}:${skillId}`
}

function compareMyPublishedSkills(left: MyPublishedSkill, right: MyPublishedSkill): number {
  const leftTime = left.updateTime ?? 0
  const rightTime = right.updateTime ?? 0

  if (leftTime !== rightTime) {
    return rightTime - leftTime
  }

  return left.displayName.localeCompare(right.displayName)
}
