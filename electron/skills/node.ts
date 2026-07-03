import type { AuthManager } from "../auth/node.ts"
import type { OoCommandResult } from "../oo-command.ts"
import type {
  CheckSkillVersionsRequest,
  DeleteSkillRequest,
  ExecuteSkillUpdateRequest,
  InstallRegistrySkillRequest,
  ManagedSkillGroup,
  OpenSkillPathRequest,
  PublishSkillRequest,
  PublishSkillResult,
  SkillDocument,
  SkillDocumentRequest,
  SkillInventoryChangedEvent,
  SkillInventory,
  SkillCliChangedEvent,
  SkillService,
  SkillSummary,
  SkillVersionReport,
  UpdateRegistrySkillRequest,
} from "./common.ts"
import type { DefaultRegistrySkillSpec } from "./default-registry-skills.ts"
import type { IConnectionService } from "@oomol/connection"
import type { FSWatcher } from "node:fs"

import { ConnectionService } from "@oomol/connection"
import { app, shell } from "electron"
import { watch } from "node:fs"
import { access, readFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildOoEnv } from "../agent/oo.ts"
import { resolveAgentSkillRoot, supportedAgents } from "../agents/catalog.ts"
import { logDiagnosticOnChange } from "../diagnostics-log.ts"
import { ooEndpoint } from "../domain.ts"
import { runOoCommand } from "../oo-command.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  assertSkillOperationSucceeded,
  createDeleteSkillArgs,
  createCliUpdateArgs,
  createInstallRegistrySkillArgs,
  createPublishSkillArgs,
  createSkillPublishErrorMessage,
  createSkillSearchArgs,
  createUpdateRegistrySkillArgs,
  normalizeSkillSearchResults,
} from "./actions.ts"
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
import {
  assertCanReplaceSharedSkillTarget,
  normalizeSkillId,
  readDeletableSkillTargetPaths,
  replaceDirectory,
} from "./file-operations.ts"
import { mergeInstalledSkillSnapshots, readSkillCoverageAgents } from "./inventory-snapshot.ts"
import { buildSummary, groupInstalledSkills } from "./inventory.ts"
import {
  areManifestStoresEqual,
  readManifestStore,
  replaceManifestRecords,
  upsertManifestRecords,
  writeManifestStore,
} from "./manifest.ts"
import { resolveSharedAgentSkillRoot } from "./paths.ts"
import { ensureSkillPublishMetadata } from "./publish-metadata.ts"
import { assertSafeResetPaths } from "./reset.ts"
import { scanInstalledSkills, scanWantaInstalledSkills } from "./scan.ts"
import { resolveUsableRegistrySkillSourcePath } from "./source.ts"
import { createVersionReportCacheKey } from "./version-report-cache.ts"
import { readSkillVersionReport } from "./version-report.ts"

interface SkillVersionAuthSnapshot {
  cacheKey: string
}

interface SkillServiceOptions {
  onRuntimeSkillsChanged?: (reason: string) => void
}

export class SkillServiceImpl extends ConnectionService<SkillService> implements IConnectionService<SkillService> {
  private readonly authService: AuthManager
  private readonly watchers: FSWatcher[] = []
  private versionReportCache: { generation: number; key: string; report: SkillVersionReport; time: number } | undefined
  private versionReportInFlight: { generation: number; key: string; promise: Promise<SkillVersionReport> } | undefined
  private versionReportCacheGeneration = 0
  private inventoryInFlight: { promise: Promise<SkillInventory>; writeManifest: boolean } | undefined
  private defaultRegistrySkillInstallInFlight: Promise<void> | undefined
  private inventoryChangeTimer: NodeJS.Timeout | undefined
  private readonly options: SkillServiceOptions
  private readonly unsubscribeAuthStateChanged: () => void
  private isDisposed = false
  public readonly cliChanged = new ServiceEvent<SkillCliChangedEvent>()
  public readonly inventoryChanged = new ServiceEvent<SkillInventoryChangedEvent>()

  public constructor(authService: AuthManager, options: SkillServiceOptions = {}) {
    super(SkillServiceName)
    this.authService = authService
    this.options = options
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

  private getWantaSkillStoreRoot(): string {
    return path.join(app.getPath("userData"), "agent", "oo-store", "config", "skills")
  }

  private getSharedAgentSkillRoot(): string {
    return resolveSharedAgentSkillRoot(os.homedir())
  }

  private async runOoCommand(
    args: string[],
    options: Omit<Parameters<typeof runOoCommand>[1], "env">,
  ): Promise<OoCommandResult> {
    await this.authService.getAuthState()
    const authToken = await this.authService.currentSessionToken()

    if (!authToken) {
      throw new Error("Skills not available (sign in first)")
    }

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

  public async checkSkillInventory(): Promise<SkillInventory> {
    const inventory = await this.readSharedSkillInventory({ writeManifest: true })
    await this.emitInventoryChanged()
    return inventory
  }

  public async getSkillSummary(): Promise<SkillSummary> {
    return (await this.getSkillInventory()).summary
  }

  public async ensureDefaultRegistrySkillsInstalled(
    specs: readonly DefaultRegistrySkillSpec[] = defaultRegistrySkills,
  ): Promise<void> {
    if (this.defaultRegistrySkillInstallInFlight) {
      return this.defaultRegistrySkillInstallInFlight
    }

    const promise = this.installDefaultRegistrySkills(specs)
    this.defaultRegistrySkillInstallInFlight = promise

    try {
      await promise
    } finally {
      if (this.defaultRegistrySkillInstallInFlight === promise) {
        this.defaultRegistrySkillInstallInFlight = undefined
      }
    }
  }

  public async searchRegistrySkills(request: { query: string }) {
    const result = await this.runOoCommand(createSkillSearchArgs(request.query), {
      owner: "skill-service",
    })

    return normalizeSkillSearchResults(result.stdout)
  }

  public async installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory> {
    const result = await this.runOoCommand(createInstallRegistrySkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
    await this.syncCachedSkillToSharedAgentRoot(request.skillId, { force: false, packageName: request.packageName })
    this.notifyRuntimeSkillsChanged("install-registry-skill")

    return this.readAndPublishSkillInventory()
  }

  public async updateRegistrySkill(request: UpdateRegistrySkillRequest): Promise<SkillInventory> {
    const result = await this.runOoCommand(createUpdateRegistrySkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.update")
    await this.syncUpdatedCachedSkillsToSharedAgentRoot(request)
    this.notifyRuntimeSkillsChanged("update-registry-skill")

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
    this.notifyRuntimeSkillsChanged("update-skill-cli")
    await this.emitInventoryChanged()
    return this.checkSkillVersions({ forceRefresh: true })
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

  public async publishSkill(request: PublishSkillRequest): Promise<PublishSkillResult> {
    const skillPath = await this.resolveAllowedSkillPath(request.path)
    await ensureSkillPublishMetadata({
      accountName: this.authService.activeAccount()?.name,
      skillPath,
    })
    const args = createPublishSkillArgs({ ...request, path: skillPath })
    const result = await this.runOoCommand(args, {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillPublishResult(result, args)
    this.invalidateVersionReport()
    this.notifyRuntimeSkillsChanged("publish-skill")

    return {
      inventory: await this.readAndPublishSkillInventory(),
      message: result.stdout.trim(),
    }
  }

  public async deleteSkill(request: DeleteSkillRequest): Promise<SkillInventory> {
    if (!request.confirmed) {
      throw new Error("Skill deletion requires confirmation.")
    }

    const skillId = normalizeSkillId(request.skillId)
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const group = inventory.groups.find((item) => item.id === skillId)

    if (!group) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    let registryUninstallError: unknown
    if (group.kind === "registry" && group.packageName?.trim()) {
      try {
        const result = await this.runOoCommand(createDeleteSkillArgs({ skillId }), {
          owner: "skill-service",
          rejectOnFailure: false,
        })
        assertOoSkillOperationResult(result, "skills.uninstall")
      } catch (cause) {
        registryUninstallError = cause
      }
    }

    const deletedTargets = await this.deleteInstalledSkillTargets(group)
    if (deletedTargets === 0 && registryUninstallError) {
      throw registryUninstallError
    }
    if (deletedTargets === 0) {
      throw new Error(`No installed Skill target found: ${skillId}`)
    }

    await this.rememberDefaultRegistrySkillRemovedByUser(skillId)
    this.notifyRuntimeSkillsChanged("delete-skill")

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

    const watchedPaths = [
      { pathname: path.dirname(this.getManifestPath()), affectsRuntimeSkills: false },
      { pathname: this.getSharedAgentSkillRoot(), affectsRuntimeSkills: true },
      { pathname: this.getWantaSkillStoreRoot(), affectsRuntimeSkills: false },
      ...supportedAgents.map((agent) => ({ pathname: resolveAgentSkillRoot(agent), affectsRuntimeSkills: false })),
    ]
    const registeredPaths = new Set<string>()
    const recursive = process.platform === "darwin" || process.platform === "win32"

    for (const { pathname, affectsRuntimeSkills } of watchedPaths) {
      if (registeredPaths.has(pathname)) {
        continue
      }
      registeredPaths.add(pathname)
      try {
        this.watchers.push(
          watch(pathname, { persistent: false, recursive }, () => {
            this.scheduleInventoryChanged()
            if (affectsRuntimeSkills) {
              this.notifyRuntimeSkillsChanged("skill-files-changed")
            }
          }),
        )
        logDiagnosticOnChange(`skill-service:watch:${pathname}`, "skill-service", "watching skill path", {
          affectsRuntimeSkills,
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
          { affectsRuntimeSkills, error: message, pathname, recursive },
          isMissing ? "trace" : "warn",
          isMissing
            ? { affectsRuntimeSkills, missing: true, pathname, recursive }
            : { affectsRuntimeSkills, error: message, pathname, recursive },
        )
        // 目录可能尚不存在；focus/background refresh 仍会兜底发现后续变化。
      }
    }
  }

  private notifyRuntimeSkillsChanged(reason: string): void {
    this.options.onRuntimeSkillsChanged?.(reason)
  }

  private scheduleInventoryChanged(): void {
    this.invalidateVersionReport()
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

  private async installDefaultRegistrySkills(specs: readonly DefaultRegistrySkillSpec[]): Promise<void> {
    const enabledSpecs = specs.filter((spec) => spec.enabled)
    if (enabledSpecs.length === 0) {
      return
    }

    const store = this.getDefaultSkillInstallStore()
    let installStore = await store.read()
    let inventory = await this.readSharedSkillInventory({ writeManifest: true })

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

      if (existingRecord?.status === "removed-by-user") {
        continue
      }

      try {
        inventory = await this.installRegistrySkill(request)
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

  private async refreshManifestRecordsForTargets(targetPaths: string[]): Promise<void> {
    const manifestPath = this.getManifestPath()
    const [installedSkills, manifestStore] = await Promise.all([
      scanWantaInstalledSkills({
        cacheSkillStoreRoot: this.getWantaSkillStoreRoot(),
        sharedSkillRoot: this.getSharedAgentSkillRoot(),
      }),
      readManifestStore(manifestPath),
    ])
    const targetPathSet = new Set(targetPaths)
    const targetSkills = installedSkills.filter((skill) => targetPathSet.has(skill.path))
    await writeManifestStore(manifestPath, replaceManifestRecords(manifestStore, targetSkills))
  }

  private async syncUpdatedCachedSkillsToSharedAgentRoot(request: UpdateRegistrySkillRequest): Promise<void> {
    const skillId = request.skillId?.trim()
    if (skillId) {
      const inventory = await this.readSkillInventory({ writeManifest: false })
      const group = inventory.groups.find((item) => item.id === skillId)
      if (group?.kind !== "registry" || !group.packageName?.trim()) {
        return
      }
      await this.syncCachedSkillToSharedAgentRoot(skillId, {
        force: true,
        packageName: request.packageName?.trim() || group.packageName,
      })
      return
    }

    const inventory = await this.readSkillInventory({ writeManifest: false })
    const registrySkillIds = inventory.groups
      .filter((group) => group.kind === "registry" && Boolean(group.packageName?.trim()))
      .map((group) => group.id)

    for (const registrySkillId of registrySkillIds) {
      const packageName = inventory.groups.find((group) => group.id === registrySkillId)?.packageName
      await this.syncCachedSkillToSharedAgentRoot(registrySkillId, { force: true, packageName })
    }
  }

  private async syncCachedSkillToSharedAgentRoot(
    skillId: string,
    options: { force: boolean; packageName?: string },
  ): Promise<void> {
    const normalizedSkillId = normalizeSkillId(skillId)
    let sourcePath = await this.resolveCachedSkillSourcePath(normalizedSkillId, {
      packageName: options.packageName,
    })

    if (!sourcePath && options.packageName) {
      await this.repairCachedRegistrySkillSource({
        packageName: options.packageName,
        skillId: normalizedSkillId,
      })
      sourcePath = await this.resolveCachedSkillSourcePath(normalizedSkillId, {
        packageName: options.packageName,
      })
    }

    if (!sourcePath) {
      throw new Error(`Cached Skill source not found: ${normalizedSkillId}`)
    }

    const targetPath = this.resolveSharedSkillTargetPath(normalizedSkillId)
    assertSafeResetPaths(sourcePath, targetPath)
    await assertCanReplaceSharedSkillTarget(targetPath, options)
    await replaceDirectory(sourcePath, targetPath)
    await this.refreshManifestRecordsForTargets([targetPath])
  }

  private async resolveCachedSkillSourcePath(
    skillId: string,
    options: { includeCanonicalStore?: boolean; packageName?: string } = {},
  ): Promise<string | undefined> {
    const normalizedSkillId = normalizeSkillId(skillId)

    return resolveUsableRegistrySkillSourcePath({
      cacheSkillStoreRoot: this.getWantaSkillStoreRoot(),
      includeCanonicalStore: options.includeCanonicalStore,
      packageName: options.packageName,
      skillId: normalizedSkillId,
    })
  }

  private async repairCachedRegistrySkillSource(request: { packageName: string; skillId: string }): Promise<void> {
    const result = await this.runOoCommand(createInstallRegistrySkillArgs({ ...request, force: true }), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
  }

  private resolveSharedSkillTargetPath(skillId: string): string {
    return path.join(this.getSharedAgentSkillRoot(), normalizeSkillId(skillId))
  }

  private async deleteInstalledSkillTargets(group: ManagedSkillGroup): Promise<number> {
    const targetPaths = readDeletableSkillTargetPaths(group, this.readDeletableSkillRoots())
    let deletedTargets = 0

    for (const targetPath of targetPaths) {
      await rm(targetPath, { force: true, recursive: true })
      deletedTargets += 1
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

  private async readSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    const startedAtMs = Date.now()
    const manifestPath = this.getManifestPath()
    const [wantaInstalledSkills, externalInstalledSkills, manifestStore] = await Promise.all([
      scanWantaInstalledSkills({
        cacheSkillStoreRoot: this.getWantaSkillStoreRoot(),
        sharedSkillRoot: this.getSharedAgentSkillRoot(),
      }),
      scanInstalledSkills(),
      readManifestStore(manifestPath),
    ])
    const installedSkills = mergeInstalledSkillSnapshots(wantaInstalledSkills, externalInstalledSkills)
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
    return inventory
  }

  private async resolveAllowedSkillPath(requestPath: string): Promise<string> {
    const resolvedRequestPath = path.resolve(requestPath)
    const canonicalRequestPath = await realpath(resolvedRequestPath)
    const inventory = await this.readSkillInventory({ writeManifest: false })
    const allowedPaths = inventory.groups.flatMap((group) =>
      group.hosts.flatMap((host) => [host.path, host.sourcePath]),
    )

    for (const allowedPath of allowedPaths) {
      if (!allowedPath) {
        continue
      }

      const resolvedAllowedPath = path.resolve(allowedPath)
      const canonicalAllowedPath = await realpath(resolvedAllowedPath).catch(() => undefined)
      if (!canonicalAllowedPath) {
        continue
      }
      if (
        canonicalRequestPath === canonicalAllowedPath ||
        canonicalRequestPath.startsWith(`${canonicalAllowedPath}${path.sep}`)
      ) {
        await access(canonicalRequestPath)
        return canonicalRequestPath
      }
    }

    throw new Error("Skill path is not allowed.")
  }

  private async resolveAllowedSkillDocumentPath(requestPath: string): Promise<string> {
    const skillPath = await this.resolveAllowedSkillPath(requestPath)
    const skillFilePath = path.join(skillPath, "SKILL.md")

    await access(skillFilePath)
    return skillFilePath
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
