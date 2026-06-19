import type { AuthManager } from "../auth/node.ts"
import type { OoCommandResult } from "../oo-command.ts"
import type {
  CheckSkillVersionsRequest,
  DeleteSkillRequest,
  ExecuteSkillUpdateRequest,
  InstallRegistrySkillRequest,
  InstallBuiltInSkillRequest,
  ListPublicSkillPackagesRequest,
  OpenSkillPathRequest,
  PublicSkillPackageCatalog,
  PublishSkillRequest,
  PublishSkillResult,
  SkillDocument,
  SkillDocumentRequest,
  SkillInventoryChangedEvent,
  SkillInventory,
  SkillCliVersionCheck,
  SkillCliChangedEvent,
  SkillService,
  SkillSummary,
  SkillVersionReport,
  UpdateRegistrySkillRequest,
} from "./common.ts"
import type { InstalledSkill } from "./types.ts"
import type { IConnectionService } from "@oomol/connection"
import type { FSWatcher } from "node:fs"

import { ConnectionService } from "@oomol/connection"
import { app, shell } from "electron"
import { watch } from "node:fs"
import { access, cp, mkdir, readFile, realpath, rename, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildOoEnv } from "../agent/oo.ts"
import { resolveAgentSkillRoot, supportedAgents } from "../agents/catalog.ts"
import { logDiagnosticOnChange } from "../diagnostics-log.ts"
import { ooEndpoint, searchBaseUrl } from "../domain.ts"
import { normalizeOoCliVersion, runOoCommand } from "../oo-command.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  assertSkillOperationSucceeded,
  createDeleteSkillArgs,
  createBundledSkillVersionCheck,
  createCliCheckUpdateArgs,
  createCliUpdateArgs,
  createFailedRegistrySkillVersionCheck,
  createFailedSkillVersionCheck,
  createInstallRegistrySkillArgs,
  createPublishSkillArgs,
  normalizePublicSkillPackageCatalog,
  createRegistrySkillCheckUpdateArgs,
  createRegistrySkillVersionCheckFromUpdateResult,
  createSkillSearchArgs,
  createUpdateRegistrySkillArgs,
  normalizeCliCheckUpdateResult,
  normalizeRegistrySkillCheckUpdateResults,
  normalizeSkillSearchResults,
} from "./actions.ts"
import { SkillService as SkillServiceName } from "./common.ts"
import { builtInSkillIds, metadataFileName } from "./constants.ts"
import { buildSummary, groupInstalledSkills } from "./inventory.ts"
import {
  areManifestStoresEqual,
  readManifestStore,
  replaceManifestRecords,
  upsertManifestRecords,
  writeManifestStore,
} from "./manifest.ts"
import { resolveSharedAgentSkillRoot } from "./paths.ts"
import { assertSafeResetPaths } from "./reset.ts"
import { scanInstalledSkills, scanLumoInstalledSkills } from "./scan.ts"

const publicSkillPackageCatalogCacheTtlMs = 5 * 60_000
const publicSkillPackagePageSize = 100

interface SkillVersionAuthSnapshot {
  cacheKey: string
}

interface SkillServiceOptions {
  onRuntimeSkillsChanged?: (reason: string) => void
}

type RunSkillOoCommand = (
  args: string[],
  options: Omit<Parameters<typeof runOoCommand>[1], "env">,
) => Promise<OoCommandResult>

export class SkillServiceImpl extends ConnectionService<SkillService> implements IConnectionService<SkillService> {
  private readonly authService: AuthManager
  private readonly watchers: FSWatcher[] = []
  private readonly publicSkillPackageCatalogCacheByKey = new Map<
    string,
    { catalog: PublicSkillPackageCatalog; time: number }
  >()
  private readonly publicSkillPackageCatalogInFlightByKey = new Map<string, Promise<PublicSkillPackageCatalog>>()
  private versionReportCache: { generation: number; key: string; report: SkillVersionReport; time: number } | undefined
  private versionReportInFlight: { generation: number; key: string; promise: Promise<SkillVersionReport> } | undefined
  private versionReportCacheGeneration = 0
  private inventoryInFlight: { promise: Promise<SkillInventory>; writeManifest: boolean } | undefined
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

  private getLumoSkillStoreRoot(): string {
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
    const account = this.authService.activeAccount()

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

  public async getSkillSummary(): Promise<SkillSummary> {
    return (await this.getSkillInventory()).summary
  }

  public async searchRegistrySkills(request: { query: string }) {
    const result = await this.runOoCommand(createSkillSearchArgs(request.query), {
      owner: "skill-service",
    })

    return normalizeSkillSearchResults(result.stdout)
  }

  public async listPublicSkillPackages(
    request: ListPublicSkillPackagesRequest = {},
  ): Promise<PublicSkillPackageCatalog> {
    const next = request.next?.trim() ?? ""
    const size = request.size ?? publicSkillPackagePageSize
    const cacheKey = `${searchBaseUrl}:${size}:${next}`
    const cached = this.publicSkillPackageCatalogCacheByKey.get(cacheKey)

    if (!request.forceRefresh && cached && Date.now() - cached.time < publicSkillPackageCatalogCacheTtlMs) {
      return cached.catalog
    }

    const inFlight = this.publicSkillPackageCatalogInFlightByKey.get(cacheKey)
    if (!request.forceRefresh && inFlight) {
      return inFlight
    }

    const promise = readPublicSkillPackageCatalog({ next, size })
      .then((catalog) => {
        this.publicSkillPackageCatalogCacheByKey.set(cacheKey, { catalog, time: Date.now() })
        return catalog
      })
      .finally(() => {
        if (this.publicSkillPackageCatalogInFlightByKey.get(cacheKey) === promise) {
          this.publicSkillPackageCatalogInFlightByKey.delete(cacheKey)
        }
      })

    this.publicSkillPackageCatalogInFlightByKey.set(cacheKey, promise)
    return promise
  }

  public async installBuiltInSkill(request: InstallBuiltInSkillRequest): Promise<SkillInventory> {
    if (!builtInSkillIds.includes(request.skillId)) {
      throw new Error(`Unsupported built-in skill: ${request.skillId}`)
    }

    await this.runOoCommand(["skills", "add", request.skillId], {
      owner: "skill-service",
    })
    await this.syncCachedSkillToSharedAgentRoot(request.skillId, { force: true })
    this.notifyRuntimeSkillsChanged("install-built-in-skill")

    return this.readAndPublishSkillInventory()
  }

  public async installRegistrySkill(request: InstallRegistrySkillRequest): Promise<SkillInventory> {
    const result = await this.runOoCommand(createInstallRegistrySkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.install")
    await this.syncCachedSkillToSharedAgentRoot(request.skillId, { force: false })
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
    const result = await this.runOoCommand(createPublishSkillArgs({ ...request, path: skillPath }), {
      owner: "skill-service",
    })
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

    const result = await this.runOoCommand(createDeleteSkillArgs(request), {
      owner: "skill-service",
      rejectOnFailure: false,
    })
    assertOoSkillOperationResult(result, "skills.uninstall")
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

    if (this.versionReportInFlight?.key === cacheKey && this.versionReportInFlight.generation === cacheGeneration) {
      return this.versionReportInFlight.promise
    }

    const promise = this.readSkillVersionReport(inventory)
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
      { pathname: this.getLumoSkillStoreRoot(), affectsRuntimeSkills: false },
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

  private async refreshManifestRecordsForTargets(targetPaths: string[]): Promise<void> {
    const manifestPath = this.getManifestPath()
    const [installedSkills, manifestStore] = await Promise.all([
      scanLumoInstalledSkills({
        cacheSkillStoreRoot: this.getLumoSkillStoreRoot(),
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
      await this.syncCachedSkillToSharedAgentRoot(skillId, { force: true })
      return
    }

    const inventory = await this.readSkillInventory({ writeManifest: false })
    const registrySkillIds = inventory.groups
      .filter((group) => group.kind === "registry" && Boolean(group.packageName?.trim()))
      .map((group) => group.id)

    for (const registrySkillId of registrySkillIds) {
      await this.syncCachedSkillToSharedAgentRoot(registrySkillId, { force: true })
    }
  }

  private async syncCachedSkillToSharedAgentRoot(skillId: string, options: { force: boolean }): Promise<void> {
    const sourcePath = await this.resolveCachedSkillSourcePath(skillId)
    if (!sourcePath) {
      return
    }

    const targetPath = path.join(this.getSharedAgentSkillRoot(), skillId)
    assertSafeResetPaths(sourcePath, targetPath)
    await assertCanReplaceSharedSkillTarget(targetPath, options)
    await replaceDirectory(sourcePath, targetPath)
    await this.refreshManifestRecordsForTargets([targetPath])
  }

  private async resolveCachedSkillSourcePath(skillId: string): Promise<string | undefined> {
    if (skillId.includes("/") || skillId.includes("\\") || skillId === "." || skillId === "..") {
      throw new Error(`Invalid Skill name: ${skillId}`)
    }

    for (const sourcePath of readCachedSkillSourceCandidates(this.getLumoSkillStoreRoot(), skillId)) {
      if (await localPathExists(sourcePath)) {
        return sourcePath
      }
    }

    return undefined
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

  private async readSkillVersionReport(inventory: SkillInventory): Promise<SkillVersionReport> {
    const installedGroups = inventory.groups.filter((group) => group.hosts.some((host) => host.status === "installed"))
    const shouldCheckRegistrySkills = installedGroups.some(
      (group) => group.kind === "registry" && Boolean(group.packageName),
    )
    const registryCheckCommand = createRegistrySkillCheckUpdateArgs()
    const currentCliVersion = await readCurrentOoCliVersion((args, options) => this.runOoCommand(args, options))
    const [cli, registryChecksResult] = await Promise.all([
      this.readCliVersionCheck(currentCliVersion),
      shouldCheckRegistrySkills
        ? this.readRegistrySkillVersionChecks()
        : Promise.resolve({
            ok: true as const,
            command: registryCheckCommand,
            results: [] as ReturnType<typeof normalizeRegistrySkillCheckUpdateResults>,
          }),
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

  private async readSkillInventory(options: { writeManifest: boolean }): Promise<SkillInventory> {
    const startedAtMs = Date.now()
    const manifestPath = this.getManifestPath()
    const [lumoInstalledSkills, externalInstalledSkills, manifestStore] = await Promise.all([
      scanLumoInstalledSkills({
        cacheSkillStoreRoot: this.getLumoSkillStoreRoot(),
        sharedSkillRoot: this.getSharedAgentSkillRoot(),
      }),
      scanInstalledSkills(),
      readManifestStore(manifestPath),
    ])
    const installedSkills = mergeInstalledSkillSnapshots(lumoInstalledSkills, externalInstalledSkills)
    const nextManifestStore = upsertManifestRecords(manifestStore, installedSkills)
    const groups = groupInstalledSkills(installedSkills, nextManifestStore)
    const localProjects: SkillInventory["localProjects"] = []

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
    const canonicalRequestPath = await realpath(resolvedRequestPath)
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

async function readPublicSkillPackageCatalog(request: {
  next?: string
  size?: number
}): Promise<PublicSkillPackageCatalog> {
  const url = new URL("/v1/packages/-/skills-list", searchBaseUrl)
  const next = request.next?.trim()
  if (next) {
    url.searchParams.set("next", next)
  }
  if (request.size && Number.isFinite(request.size)) {
    url.searchParams.set("size", String(Math.min(Math.max(Math.trunc(request.size), 1), publicSkillPackagePageSize)))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Public Skill list request failed with status ${response.status}.`)
    }

    return normalizePublicSkillPackageCatalog(await response.text())
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

async function localPathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

async function assertCanReplaceSharedSkillTarget(targetPath: string, options: { force: boolean }): Promise<void> {
  if (!(await localPathExists(targetPath))) {
    return
  }

  if (options.force) {
    return
  }

  if (await localPathExists(path.join(targetPath, metadataFileName))) {
    return
  }

  throw new Error("A local Skill with the same name already exists in the shared Agent Skills directory.")
}

function mergeInstalledSkillSnapshots(
  lumoInstalledSkills: InstalledSkill[],
  externalInstalledSkills: InstalledSkill[],
): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>()

  for (const skill of externalInstalledSkills) {
    merged.set(skill.path, skill)
  }
  for (const skill of lumoInstalledSkills) {
    merged.set(skill.path, skill)
  }

  return Array.from(merged.values())
}

async function replaceDirectory(sourcePath: string, targetPath: string): Promise<void> {
  const parentPath = path.dirname(targetPath)
  const targetName = path.basename(targetPath)
  const operationId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tempPath = path.join(parentPath, `.${targetName}.tmp-${operationId}`)
  const backupPath = path.join(parentPath, `.${targetName}.backup-${operationId}`)
  let hasBackup = false

  await mkdir(parentPath, { recursive: true })
  await rm(tempPath, { force: true, recursive: true })
  await rm(backupPath, { force: true, recursive: true })

  try {
    await cp(sourcePath, tempPath, { recursive: true })

    if (await localPathExists(targetPath)) {
      await rename(targetPath, backupPath)
      hasBackup = true
    }

    try {
      await rename(tempPath, targetPath)
    } catch (cause) {
      if (hasBackup) {
        await rename(backupPath, targetPath).catch(() => undefined)
        hasBackup = false
      }
      throw cause
    }

    if (hasBackup) {
      await rm(backupPath, { force: true, recursive: true })
      hasBackup = false
    }
  } finally {
    await rm(tempPath, { force: true, recursive: true }).catch(() => undefined)
    if (hasBackup) {
      await rm(backupPath, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}

function readCachedSkillSourceCandidates(cacheSkillStoreRoot: string, skillId: string): string[] {
  return [
    path.join(cacheSkillStoreRoot, "registry", skillId),
    path.join(cacheSkillStoreRoot, "bundled", "lumo", skillId),
    path.join(cacheSkillStoreRoot, "bundled", "universal", skillId),
  ]
}
