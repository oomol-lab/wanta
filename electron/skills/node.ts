import type { AuthManager } from "../auth/node.ts"
import type { OoCommandResult } from "../oo-command.ts"
import type {
  CheckSkillVersionsRequest,
  DeleteSkillRequest,
  InstallRegistrySkillRequest,
  InstallRegistrySkillsResult,
  OpenSkillPathRequest,
  PublishSkillRequest,
  PublishSkillResult,
  SkillDocument,
  SkillDocumentRequest,
  SkillInventory,
  SkillInventoryChangedEvent,
  SkillService,
  SkillVersionReport,
  UpdateRegistrySkillRequest,
} from "./common.ts"
import type { DefaultRegistrySkillSpec } from "./default-registry-skills.ts"
import type { SkillDeleteStoreTarget } from "./delete-plan.ts"
import type { EnsureSkillPublishMetadataResult } from "./publish-metadata.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { app, shell } from "electron"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { buildOoEnv, buildOoMaintenanceEnv } from "../agent/oo.ts"
import { resolveAgentSkillRoot, supportedAgents } from "../agents/catalog.ts"
import { logDiagnostic, logDiagnosticOnChange } from "../diagnostics-log.ts"
import { ooEndpoint } from "../domain.ts"
import { runOoCommand } from "../oo-command.ts"
import { resolveOoStoreDirectory } from "../oo-store-paths.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  assertSkillOperationSucceeded,
  createDeleteSkillArgs,
  createCliUpdateArgs,
  createInstallRegistrySkillArgs,
  createPublishSkillArgs,
  createSkillPublishErrorMessage,
  createUpdateRegistrySkillArgs,
  readSkillPublishRequiredScope,
} from "./actions.ts"
import {
  resolveAllowedSkillDocumentPath as resolveAllowedDocumentPath,
  resolveAllowedSkillPath as resolveAllowedPath,
} from "./allowed-path.ts"
import { SkillService as SkillServiceName } from "./common.ts"
import {
  DefaultSkillInstallStore,
  readDefaultSkillInstallRecord,
  upsertDefaultSkillInstallRecord,
} from "./default-install-store.ts"
import {
  isRuntimeSkillInstalled,
  normalizeDefaultRegistrySkillRequest,
  runtimeErrorMessage,
} from "./default-registry-install.ts"
import { defaultRegistrySkills } from "./default-registry-skills.ts"
import { buildLocalMachineSkillDeletePlan } from "./delete-plan.ts"
import { ExternalSkillRuntimeSynchronizer } from "./external-runtime-sync.ts"
import { normalizeSkillId, removeSkillDirectoryIfSafe } from "./file-operations.ts"
import { SkillFileWatcher } from "./file-watcher.ts"
import { SkillInventoryCache } from "./inventory-cache.ts"
import { mergeInstalledSkillSnapshots, readSkillCoverageAgents } from "./inventory-snapshot.ts"
import { buildSummary, groupInstalledSkills } from "./inventory.ts"
import { areManifestStoresEqual, readManifestStore, upsertManifestRecords, writeManifestStore } from "./manifest.ts"
import { ensureSkillPublishMetadata } from "./publish-metadata.ts"
import { RegistrySkillRuntimeSynchronizer } from "./registry-runtime-sync.ts"
import {
  isSkillRemovedByUser,
  removeRemovedSkillRecord,
  RemovedSkillStore,
  upsertRemovedSkillRecord,
} from "./removed-store.ts"
import { scanInstalledSkills, scanWantaInstalledSkills } from "./scan.ts"
import { createVersionReportCacheKey } from "./version-report-cache.ts"
import { readSkillVersionReport } from "./version-report.ts"

interface SkillVersionAuthSnapshot {
  cacheKey: string
}

interface SkillServiceOptions {
  onRuntimeSkillsChanged?: (reason: string) => void
}

// 默认 Skill 安装只供主进程生命周期调用；使用 symbol 避免注册 service 时形成字符串 RPC 方法。
export const ensureDefaultRegistrySkillsInstalled = Symbol("ensureDefaultRegistrySkillsInstalled")

export class SkillServiceImpl extends ConnectionService<SkillService> implements IConnectionService<SkillService> {
  private readonly authService: AuthManager
  private readonly fileWatcher: SkillFileWatcher
  private versionReportCache: { generation: number; key: string; report: SkillVersionReport; time: number } | undefined
  private versionReportInFlight: { generation: number; key: string; promise: Promise<SkillVersionReport> } | undefined
  private versionReportCacheGeneration = 0
  private readonly inventoryCache = new SkillInventoryCache()
  private defaultRegistrySkillInstallInFlight: Promise<void> | undefined
  private readonly externalRuntimeSynchronizer: ExternalSkillRuntimeSynchronizer
  private readonly registryRuntimeSynchronizer: RegistrySkillRuntimeSynchronizer
  private skillMutationQueue: Promise<void> = Promise.resolve()
  private runtimeSyncQueue: Promise<void> = Promise.resolve()
  private removedSkillStore: RemovedSkillStore | undefined
  private readonly options: SkillServiceOptions
  private readonly unsubscribeAuthStateChanged: () => void
  private isDisposed = false
  public readonly inventoryChanged = new ServiceEvent<SkillInventoryChangedEvent>()

  public constructor(authService: AuthManager, options: SkillServiceOptions = {}) {
    super(SkillServiceName)
    this.authService = authService
    this.options = options
    this.fileWatcher = new SkillFileWatcher({
      onExternalRuntimeSync: () => this.syncExternalRuntimeSkillsAndNotify("external-skill-files-changed"),
      onFilesChanged: () => this.inventoryCache.invalidate(),
      onInventoryChanged: async () => {
        this.invalidateVersionReport()
        await this.emitInventoryChanged()
      },
      onRuntimeSkillsChanged: () => this.notifyRuntimeSkillsChanged("skill-files-changed"),
    })
    this.externalRuntimeSynchronizer = new ExternalSkillRuntimeSynchronizer({
      bundledSkillRoot: this.getBundledAgentSkillRoot(),
      manifestPath: this.getManifestPath(),
      sharedSkillRoot: this.getSharedAgentSkillRoot(),
    })
    this.registryRuntimeSynchronizer = new RegistrySkillRuntimeSynchronizer({
      cacheSkillStoreRoot: this.getWantaSkillStoreRoot(),
      loadInventory: () => this.readSharedSkillInventory({ writeManifest: false }),
      manifestPath: this.getManifestPath(),
      repairSource: (request) => this.repairCachedRegistrySkillSource(request),
      registrySkillRoot: this.getWantaRegistrySkillRoot(),
      sharedSkillRoot: this.getSharedAgentSkillRoot(),
    })
    this.unsubscribeAuthStateChanged = this.authService.stateChanged.on(() => {
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

  private getDefaultSkillInstallStore(): DefaultSkillInstallStore {
    return new DefaultSkillInstallStore(app.getPath("userData"))
  }

  private getRemovedSkillStore(): RemovedSkillStore {
    this.removedSkillStore ??= new RemovedSkillStore(app.getPath("userData"))
    return this.removedSkillStore
  }

  private getWantaSkillStoreRoot(): string {
    return path.join(app.getPath("userData"), "agent", "oo-store", "config", "skills")
  }

  private getWantaOoStoreRoot(): string {
    return path.join(app.getPath("userData"), "agent", "oo-store")
  }

  private getGlobalOoStoreRoot(): string {
    return resolveOoStoreDirectory()
  }

  private getGlobalRegistrySkillRoot(): string {
    return path.join(this.getGlobalOoStoreRoot(), "skills", "registry")
  }

  private getWantaRegistrySkillRoot(): string {
    return path.join(this.getWantaSkillStoreRoot(), "registry")
  }

  private getSharedAgentSkillRoot(): string {
    return path.join(app.getPath("userData"), "agent", "workspace", ".opencode", "skills")
  }

  private getBundledAgentSkillRoot(): string {
    return path.join(app.getPath("userData"), "agent", "workspace", ".opencode", "skill")
  }

  private async readSkillAuthToken(): Promise<string> {
    await this.authService.getAuthState()
    const authToken = await this.authService.currentSessionToken()

    if (!authToken) {
      throw new Error("Skills not available (sign in first)")
    }

    return authToken
  }

  private async runOoCommand(
    args: string[],
    options: Omit<Parameters<typeof runOoCommand>[1], "env">,
  ): Promise<OoCommandResult> {
    const authToken = await this.readSkillAuthToken()

    return runOoCommand(args, {
      ...options,
      env: buildOoEnv({
        authToken,
        storeDir: path.join(app.getPath("userData"), "agent", "oo-store"),
        ooBinPath: process.env["OO_CLI_PATH"],
      }),
    })
  }

  public async getSkillInventory(): Promise<SkillInventory> {
    return this.readSharedSkillInventory({ writeManifest: true })
  }

  public async [ensureDefaultRegistrySkillsInstalled](
    specs: readonly DefaultRegistrySkillSpec[] = defaultRegistrySkills,
  ): Promise<void> {
    if (this.defaultRegistrySkillInstallInFlight) {
      return this.defaultRegistrySkillInstallInFlight
    }

    const promise = this.enqueueSkillMutation(() => this.installDefaultRegistrySkills(specs))
    this.defaultRegistrySkillInstallInFlight = promise

    try {
      await promise
    } finally {
      if (this.defaultRegistrySkillInstallInFlight === promise) {
        this.defaultRegistrySkillInstallInFlight = undefined
      }
    }
  }

  public async installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory> {
    return this.enqueueSkillMutation(async () => {
      await this.installRegistrySkillTarget(request)
      this.notifyRuntimeSkillsChanged("install-registry-skill")
      return this.readAndPublishSkillInventory()
    })
  }

  public async installRegistrySkills(requests: InstallRegistrySkillRequest[]): Promise<InstallRegistrySkillsResult> {
    if (!Array.isArray(requests) || requests.length > 100) {
      throw new Error("Skill batch install accepts at most 100 targets.")
    }
    return this.enqueueSkillMutation(async () => {
      const installed: InstallRegistrySkillRequest[] = []
      const failures: InstallRegistrySkillsResult["failures"] = []
      const uniqueRequests = Array.from(
        new Map(
          requests.map((request) => [
            `${request.packageName.trim()}\u0000${request.skillId.trim()}`,
            { packageName: request.packageName.trim(), skillId: request.skillId.trim() },
          ]),
        ).values(),
      ).filter((request) => request.packageName && request.skillId)

      for (const request of uniqueRequests) {
        try {
          await this.installRegistrySkillTarget(request)
          installed.push(request)
        } catch (error) {
          failures.push({ ...request, error: runtimeErrorMessage(error) })
        }
      }

      if (installed.length > 0) {
        this.notifyRuntimeSkillsChanged("install-registry-skills")
      }
      return {
        failures,
        installed,
        inventory: await this.readAndPublishSkillInventory(),
      }
    })
  }

  private async installRegistrySkillTarget(request: InstallRegistrySkillRequest): Promise<void> {
    const result = await this.runOoCommand(createInstallRegistrySkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
    await this.forgetRemovedSkill(request)
    await this.enqueueRuntimeSync(() =>
      this.registryRuntimeSynchronizer.syncSkill(request.skillId, {
        force: false,
        packageName: request.packageName,
      }),
    )
  }

  public async updateRegistrySkill(request: UpdateRegistrySkillRequest): Promise<SkillInventory> {
    return this.enqueueSkillMutation(async () => {
      const result = await this.runOoCommand(createUpdateRegistrySkillArgs(request), {
        owner: "skill-service",
        rejectOnFailure: false,
      })
      assertOoSkillOperationResult(result, "skills.update")
      await this.enqueueRuntimeSync(() => this.registryRuntimeSynchronizer.syncUpdated(request))
      this.notifyRuntimeSkillsChanged("update-registry-skill")

      return this.readAndPublishSkillInventory()
    })
  }

  public async executeCliUpdate(): Promise<SkillVersionReport> {
    return this.enqueueSkillMutation(async () => {
      await this.runOoCommand(createCliUpdateArgs(), {
        owner: "skill-service",
      })
      this.invalidateVersionReport()
      this.notifyRuntimeSkillsChanged("update-skill-cli")
      await this.emitInventoryChanged()
      return this.checkSkillVersions({ forceRefresh: true })
    })
  }

  public async openSkillFolder(request: OpenSkillPathRequest): Promise<void> {
    const skillPath = await this.resolveAllowedSkillPath(request.path)
    const error = await shell.openPath(skillPath)

    if (error) {
      throw new Error(error)
    }
  }

  public async readSkillDocument(request: SkillDocumentRequest): Promise<SkillDocument> {
    const skillFilePath = await this.resolveAllowedSkillDocumentPath(request.path)

    return {
      content: await readFile(skillFilePath, "utf8"),
      path: skillFilePath,
    }
  }

  public async openSkillDocument(request: SkillDocumentRequest): Promise<void> {
    const skillFilePath = await this.resolveAllowedSkillDocumentPath(request.path)
    const error = await shell.openPath(skillFilePath)

    if (error) {
      throw new Error(error)
    }
  }

  private async attemptPublishSkill(input: {
    packageScope?: string
    request: PublishSkillRequest
    skillPath: string
  }): Promise<{ args: string[]; metadata: EnsureSkillPublishMetadataResult; result: OoCommandResult }> {
    const metadata = await ensureSkillPublishMetadata({
      accountName: this.authService.activeAccount()?.name,
      packageScope: input.packageScope,
      skillPath: input.skillPath,
    })
    const args = createPublishSkillArgs({ ...input.request, path: input.skillPath })
    const result = await this.runOoCommand(args, {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    return { args, metadata, result }
  }

  public async publishSkill(request: PublishSkillRequest): Promise<PublishSkillResult> {
    return this.enqueueSkillMutation(() => this.publishSkillUnlocked(request))
  }

  private async publishSkillUnlocked(request: PublishSkillRequest): Promise<PublishSkillResult> {
    const skillPath = await this.resolveAllowedSkillPath(request.path)
    let { args, metadata, result } = await this.attemptPublishSkill({ request, skillPath })
    const requiredScope = readSkillPublishRequiredScope(result)
    if (!result.ok && requiredScope) {
      ;({ args, metadata, result } = await this.attemptPublishSkill({
        packageScope: requiredScope,
        request,
        skillPath,
      }))
    }
    assertOoSkillPublishResult(result, args)
    this.invalidateVersionReport()
    this.notifyRuntimeSkillsChanged("publish-skill")

    return {
      inventory: await this.readAndPublishSkillInventory(),
      message: result.stdout.trim(),
      packageName: metadata.packageName,
      version: metadata.version,
    }
  }

  public async deleteSkill(request: DeleteSkillRequest): Promise<SkillInventory> {
    return this.enqueueSkillMutation(() => this.deleteSkillUnlocked(request))
  }

  private async deleteSkillUnlocked(request: DeleteSkillRequest): Promise<SkillInventory> {
    if (!request.confirmed) {
      throw new Error("Skill deletion requires confirmation.")
    }

    const skillId = normalizeSkillId(request.skillId)
    const inventory = await this.readSharedSkillInventory({ writeManifest: false })
    const group = inventory.groups.find((item) => item.id === skillId)

    if (!group) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    const plan = buildLocalMachineSkillDeletePlan({
      agentSkillRoots: this.readDeletableSkillRoots(),
      globalRegistrySkillRoot: this.getGlobalRegistrySkillRoot(),
      group,
      wantaRegistrySkillRoot: this.getWantaRegistrySkillRoot(),
    })
    const uninstallErrors = await this.uninstallRegistrySkillFromStores(plan.storeTargets)
    const removedTargets = await this.deleteSkillPlanTargets(plan)
    const uninstallSucceeded = plan.storeTargets.length > uninstallErrors.length

    if (removedTargets === 0 && !uninstallSucceeded && uninstallErrors.length > 0) {
      throw uninstallErrors[0]
    }
    if (removedTargets === 0 && !uninstallSucceeded) {
      throw new Error(`No installed Skill target found: ${skillId}`)
    }

    if (group.kind === "registry") {
      await this.rememberDefaultRegistrySkillRemovedByUser(skillId)
      await this.rememberRemovedSkill({
        packageName: group.packageName,
        skillId,
      })
    }
    this.notifyRuntimeSkillsChanged("delete-skill")

    return this.readAndPublishSkillInventory()
  }

  public async checkSkillVersions(request: CheckSkillVersionsRequest = {}): Promise<SkillVersionReport> {
    const inventory = await this.readSharedSkillInventory({ writeManifest: false })
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

    if (
      !request.forceRefresh &&
      this.versionReportInFlight?.key === cacheKey &&
      this.versionReportInFlight.generation === cacheGeneration
    ) {
      return this.versionReportInFlight.promise
    }

    const promise = readSkillVersionReport(inventory, (args, options) => this.runOoCommand(args, options))
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

    this.fileWatcher.dispose()

    this.unsubscribeAuthStateChanged()
    super.dispose()
  }

  private startWatching(): void {
    if (this.isDisposed) {
      return
    }
    this.fileWatcher.start([
      { pathname: path.dirname(this.getManifestPath()), affectsRuntimeSkills: false, syncRuntimeSkills: false },
      { pathname: this.getSharedAgentSkillRoot(), affectsRuntimeSkills: true, syncRuntimeSkills: false },
      { pathname: this.getWantaSkillStoreRoot(), affectsRuntimeSkills: false, syncRuntimeSkills: false },
      ...supportedAgents.map((agent) => ({
        pathname: resolveAgentSkillRoot(agent),
        affectsRuntimeSkills: false,
        syncRuntimeSkills: true,
      })),
    ])
  }

  private notifyRuntimeSkillsChanged(reason: string): void {
    this.options.onRuntimeSkillsChanged?.(reason)
  }

  private async syncExternalRuntimeSkillsAndNotify(reason: string): Promise<void> {
    const removedStore = await this.getRemovedSkillStore().read()
    const synced = await this.syncExternalAgentSkillsToRuntimeRoot(removedStore)
    if (!synced) {
      return
    }

    this.inventoryCache.invalidate()
    this.notifyRuntimeSkillsChanged(reason)
    await this.emitInventoryChanged()
  }

  private async emitInventoryChanged(): Promise<void> {
    const event: SkillInventoryChangedEvent = {
      updatedAt: new Date().toISOString(),
    }

    this.inventoryChanged.emit(event)
    await this.send("skillInventoryChanged", event)
  }

  private async installDefaultRegistrySkills(specs: readonly DefaultRegistrySkillSpec[]): Promise<void> {
    const enabledSpecs = specs.filter((spec) => spec.enabled)
    if (enabledSpecs.length === 0) {
      return
    }

    const store = this.getDefaultSkillInstallStore()
    let installStore = await store.read()
    const removedStore = await this.getRemovedSkillStore().read()
    const syncedCachedRuntimeSkills = await this.enqueueRuntimeSync(() =>
      this.registryRuntimeSynchronizer.syncMissing(removedStore),
    )
    let inventory = await this.readSharedSkillInventory({ writeManifest: true })
    if (syncedCachedRuntimeSkills) {
      this.notifyRuntimeSkillsChanged("sync-cached-registry-skills")
      await this.emitInventoryChanged()
    }

    for (const spec of enabledSpecs) {
      const request = normalizeDefaultRegistrySkillRequest(spec)
      const existingRecord = readDefaultSkillInstallRecord(installStore, request)
      const now = new Date().toISOString()

      if (isRuntimeSkillInstalled(inventory, request.skillId)) {
        installStore = upsertDefaultSkillInstallRecord(installStore, {
          ...request,
          installedAt: existingRecord?.installedAt ?? now,
          status: "installed",
          updatedAt: now,
        })
        await store.write(installStore)
        continue
      }

      if (existingRecord?.status === "removed-by-user" || isSkillRemovedByUser(removedStore, request)) {
        continue
      }

      try {
        await this.installRegistrySkillTarget(request)
        this.notifyRuntimeSkillsChanged("install-default-registry-skill")
        inventory = await this.readAndPublishSkillInventory()
        installStore = upsertDefaultSkillInstallRecord(installStore, {
          ...request,
          installedAt: now,
          lastAttemptAt: now,
          status: "installed",
          updatedAt: now,
        })
      } catch (error) {
        const message = runtimeErrorMessage(error)
        console.warn("[wanta] failed to install default registry skill:", {
          error: message,
          packageName: request.packageName,
          skillId: request.skillId,
        })
        installStore = upsertDefaultSkillInstallRecord(installStore, {
          ...request,
          lastAttemptAt: now,
          lastError: message,
          status: "failed",
          updatedAt: now,
        })
      }

      await store.write(installStore)
    }

    const syncedExternalRuntimeSkills = await this.syncExternalAgentSkillsToRuntimeRoot(removedStore)
    if (syncedExternalRuntimeSkills) {
      this.notifyRuntimeSkillsChanged("sync-external-agent-skills")
      await this.emitInventoryChanged()
    }
  }

  private async syncExternalAgentSkillsToRuntimeRoot(
    removedStore: Awaited<ReturnType<RemovedSkillStore["read"]>>,
  ): Promise<boolean> {
    return this.enqueueRuntimeSync(() => this.externalRuntimeSynchronizer.sync(removedStore))
  }

  private enqueueRuntimeSync<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.runtimeSyncQueue.catch(() => undefined).then(operation)
    this.runtimeSyncQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private enqueueSkillMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.skillMutationQueue.catch(() => undefined).then(operation)
    this.skillMutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async rememberDefaultRegistrySkillRemovedByUser(skillId: string): Promise<void> {
    const normalizedSkillId = normalizeSkillId(skillId)
    const spec = defaultRegistrySkills.find((item) => item.skillId.trim() === normalizedSkillId)
    if (!spec) {
      return
    }

    const request = normalizeDefaultRegistrySkillRequest(spec)
    const store = this.getDefaultSkillInstallStore()
    const current = await store.read()
    const now = new Date().toISOString()

    await store.write(
      upsertDefaultSkillInstallRecord(current, {
        ...request,
        status: "removed-by-user",
        updatedAt: now,
      }),
    )
  }

  private async rememberRemovedSkill(skill: { packageName?: string; skillId: string }): Promise<void> {
    const store = this.getRemovedSkillStore()
    await store.update((current) =>
      upsertRemovedSkillRecord(current, {
        packageName: skill.packageName?.trim() || undefined,
        removedAt: new Date().toISOString(),
        scope: "local-machine",
        skillId: normalizeSkillId(skill.skillId),
      }),
    )
  }

  private async forgetRemovedSkill(skill: { packageName?: string; skillId: string }): Promise<void> {
    const store = this.getRemovedSkillStore()
    await store.update((current) => removeRemovedSkillRecord(current, skill))
  }

  private async repairCachedRegistrySkillSource(request: { packageName: string; skillId: string }): Promise<void> {
    const result = await this.runOoCommand(createInstallRegistrySkillArgs({ ...request, force: true }), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
  }

  private async uninstallRegistrySkillFromStores(targets: SkillDeleteStoreTarget[]): Promise<unknown[]> {
    const errors: unknown[] = []

    for (const target of targets) {
      try {
        const result = await this.runOoSkillStoreCommand(target, createDeleteSkillArgs({ skillId: target.skillId }))
        assertOoSkillOperationResult(result, "skills.uninstall")
      } catch (cause) {
        errors.push(cause)
        logDiagnostic(
          "skills",
          "registry skill uninstall failed during local-machine delete",
          {
            error: cause,
            packageName: target.packageName,
            skillId: target.skillId,
            store: target.kind,
          },
          "warn",
        )
      }
    }

    return errors
  }

  private async runOoSkillStoreCommand(
    target: Pick<SkillDeleteStoreTarget, "kind">,
    args: string[],
  ): Promise<OoCommandResult> {
    const authToken = await this.readSkillAuthToken()

    const globalStoreRoot = this.getGlobalOoStoreRoot()
    const env =
      target.kind === "global"
        ? buildOoMaintenanceEnv({
            authToken,
            configDir: globalStoreRoot,
            dataDir: path.join(globalStoreRoot, "data"),
            logDir: path.join(globalStoreRoot, "log"),
            ooBinPath: process.env["OO_CLI_PATH"],
          })
        : buildOoEnv({
            authToken,
            storeDir: this.getWantaOoStoreRoot(),
            ooBinPath: process.env["OO_CLI_PATH"],
          })

    return runOoCommand(args, {
      env,
      owner: "skill-service",
      rejectOnFailure: false,
    })
  }

  private async deleteSkillPlanTargets(plan: ReturnType<typeof buildLocalMachineSkillDeletePlan>): Promise<number> {
    const allowedRoots = [
      ...this.readDeletableSkillRoots(),
      this.getWantaRegistrySkillRoot(),
      this.getGlobalRegistrySkillRoot(),
    ]
    let deletedTargets = 0

    for (const target of plan.targets) {
      const result = await removeSkillDirectoryIfSafe({
        allowedRoots,
        packageName: plan.packageName,
        path: target.path,
        skillId: plan.skillId,
      })

      if (result.status === "removed") {
        deletedTargets += 1
      } else if (result.reason !== "missing") {
        logDiagnostic(
          "skills",
          "skill delete target skipped",
          {
            path: result.path,
            reason: result.reason,
            skillId: plan.skillId,
            targetKind: target.kind,
          },
          "warn",
        )
      }
    }

    return deletedTargets
  }

  private readDeletableSkillRoots(): string[] {
    return [this.getSharedAgentSkillRoot(), ...supportedAgents.map((agent) => resolveAgentSkillRoot(agent))]
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
    const inventory = await this.refreshSharedSkillInventory({ writeManifest: true })
    await this.emitInventoryChanged()
    return inventory
  }

  private async readSharedSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    return this.inventoryCache.get(options, (request) => this.readSkillInventory(request))
  }

  private async refreshSharedSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    return this.inventoryCache.refresh(options, (request) => this.readSkillInventory(request))
  }

  private async readSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    const startedAtMs = Date.now()
    const manifestPath = this.getManifestPath()
    const [wantaInstalledSkills, externalInstalledSkills, manifestStore, removedStore] = await Promise.all([
      scanWantaInstalledSkills({
        cacheSkillStoreRoot: this.getWantaSkillStoreRoot(),
        sharedSkillRoot: this.getSharedAgentSkillRoot(),
      }),
      scanInstalledSkills(),
      readManifestStore(manifestPath),
      this.getRemovedSkillStore().read(),
    ])
    const installedSkills = mergeInstalledSkillSnapshots(wantaInstalledSkills, externalInstalledSkills).filter(
      (skill) =>
        !isSkillRemovedByUser(removedStore, {
          packageName: skill.metadata.packageName,
          skillId: skill.name,
        }),
    )
    const nextManifestStore = upsertManifestRecords(manifestStore, installedSkills)
    const groups = groupInstalledSkills(installedSkills, nextManifestStore, readSkillCoverageAgents(installedSkills))

    if (options.writeManifest && !areManifestStoresEqual(manifestStore, nextManifestStore)) {
      await writeManifestStore(manifestPath, nextManifestStore)
    }

    const inventory = {
      groups,
      summary: buildSummary(groups),
      updatedAt: new Date().toISOString(),
    }
    const diagnosticFields = {
      durationMs: Date.now() - startedAtMs,
      groupCount: inventory.groups.length,
      installedSkillCount: installedSkills.length,
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
        managedSkillCount: diagnosticFields.managedSkillCount,
        manifestPath: diagnosticFields.manifestPath,
        needsAttention: diagnosticFields.needsAttention,
        registrySkillCount: diagnosticFields.registrySkillCount,
      },
    )
    logDiagnostic("performance", "skill inventory scan", diagnosticFields, "trace")
    return inventory
  }

  private async resolveAllowedSkillPath(requestPath: string): Promise<string> {
    const inventory = await this.readSharedSkillInventory({ writeManifest: false })
    const allowedPaths = inventory.groups.flatMap((group) =>
      group.hosts.flatMap((host) => [host.path, host.sourcePath]),
    )
    return resolveAllowedPath(requestPath, allowedPaths)
  }

  private async resolveAllowedSkillDocumentPath(requestPath: string): Promise<string> {
    const inventory = await this.readSharedSkillInventory({ writeManifest: false })
    const allowedPaths = inventory.groups.flatMap((group) =>
      group.hosts.flatMap((host) => [host.path, host.sourcePath]),
    )
    return resolveAllowedDocumentPath(requestPath, allowedPaths)
  }

  private async readAuthSnapshot(): Promise<SkillVersionAuthSnapshot> {
    await this.authService.getAuthState()
    const account = this.authService.activeAccount()

    if (!account) {
      return {
        cacheKey: "signed-out",
      }
    }

    return {
      cacheKey: `${account.id}@${ooEndpoint}`,
    }
  }
}

function assertOoSkillPublishResult(result: OoCommandResult, args: readonly string[]): void {
  if (result.ok) {
    return
  }

  const message = createSkillPublishErrorMessage(result)
  throw Object.assign(new Error(message), {
    diagnostics: createSkillPublishDiagnostics(message, args, result),
  })
}

function createSkillPublishDiagnostics(message: string, args: readonly string[], result: OoCommandResult): string {
  return [
    "Skill publish failed.",
    `command: oo ${args.join(" ")}`,
    `message: ${message}`,
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : undefined,
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
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
