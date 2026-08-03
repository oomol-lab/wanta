import type { LarkCliState } from "./common.ts"
import type { ChildProcess } from "node:child_process"

import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { gunzipSync, inflateRawSync } from "node:zlib"
import { atomicWriteText } from "../atomic-file.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { ServiceEvent } from "../service-events.ts"

const execFileAsync = promisify(execFile)
const updateCheckTimeoutMs = 3_000
const downloadTimeoutMs = 60_000
const authorizationTimeoutMs = 10 * 60_000
const maxOutputBytes = 512 * 1024
const maxDownloadBytes = 128 * 1024 * 1024
const officialReleaseBase = "https://github.com/larksuite/cli/releases/download"
const npmLatestUrl = "https://registry.npmjs.org/@larksuite/cli/latest"

interface ActiveBundle {
  binaryPath: string
  skillsDir: string
  source: "bundled" | "managed"
  version: string
}

interface PersistedActiveBundle {
  version: 1
  activeVersion: string
}

export interface LarkCliManagerOptions {
  bundledBinaryPath: string
  bundledSkillsDir: string
  fetch?: typeof fetch
  onRuntimeChanged?: () => Promise<void> | void
  openExternalUrl: (url: string) => void
  platform?: NodeJS.Platform
  arch?: string
  rootDir: string
}

interface CommandResult {
  stderr: string
  stdout: string
}

interface SkillDirectoryEntry {
  is_dir?: boolean
  path?: string
}

export class LarkCliManager {
  private readonly bundledBinaryPath: string
  private readonly bundledSkillsDir: string
  private readonly fetch: typeof fetch
  private readonly onRuntimeChanged?: () => Promise<void> | void
  private readonly openExternalUrl: (url: string) => void
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly rootDir: string
  private operation: Promise<LarkCliState> | null = null
  private activeChild: ChildProcess | null = null
  private cancelRequested = false
  private state: LarkCliState = {
    activeVersion: null,
    available: false,
    bundledVersion: null,
    connection: "disconnected",
    phase: "idle",
    updateStatus: "idle",
  }
  public readonly stateChanged = new ServiceEvent<LarkCliState>()

  public constructor(options: LarkCliManagerOptions) {
    this.bundledBinaryPath = options.bundledBinaryPath
    this.bundledSkillsDir = options.bundledSkillsDir
    this.fetch = options.fetch ?? globalThis.fetch
    this.onRuntimeChanged = options.onRuntimeChanged
    this.openExternalUrl = options.openExternalUrl
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.rootDir = options.rootDir
  }

  public async getState(): Promise<LarkCliState> {
    if (this.operation) return this.state
    try {
      const bundle = await this.resolveActiveBundle()
      const auth = await this.readAuthState(bundle.binaryPath)
      this.state = {
        ...this.state,
        activeVersion: bundle.version,
        available: true,
        bundledVersion: await this.readVersion(this.bundledBinaryPath).catch(() => null),
        connection: auth.connection,
        accountLabel: auth.accountLabel,
        phase: "idle",
      }
    } catch (error) {
      this.state = {
        ...this.state,
        activeVersion: null,
        available: false,
        connection: "disconnected",
        error: errorMessage(error),
        phase: "idle",
      }
    }
    return this.state
  }

  public connect(): Promise<LarkCliState> {
    if (this.operation) return this.operation
    this.cancelRequested = false
    const operation = this.connectNow()
      .catch((error: unknown) => {
        this.setState({ error: this.cancelRequested ? undefined : errorMessage(error), phase: "idle" })
        throw error
      })
      .finally(() => {
        if (this.operation === operation) this.operation = null
      })
    this.operation = operation
    return operation
  }

  public disconnect(): Promise<LarkCliState> {
    if (this.operation) return Promise.reject(new Error("A Lark CLI connection operation is already running."))
    const operation = this.disconnectNow()
      .catch((error: unknown) => {
        this.setState({ error: errorMessage(error), phase: "idle" })
        throw error
      })
      .finally(() => {
        if (this.operation === operation) this.operation = null
      })
    this.operation = operation
    return operation
  }

  public cancelConnection(): void {
    this.cancelRequested = true
    this.activeChild?.kill()
    this.activeChild = null
    this.setState({ phase: "idle" })
  }

  public async activeRuntime(): Promise<ActiveBundle | null> {
    try {
      return await this.resolveActiveBundle()
    } catch {
      return null
    }
  }

  private async connectNow(): Promise<LarkCliState> {
    this.setState({ error: undefined, phase: "checking", updateStatus: "checking" })
    let bundle = await this.resolveActiveBundle()
    try {
      bundle = await this.installLatestIfAvailable(bundle)
    } catch (error) {
      logDiagnostic("lark-cli", "Lark CLI update failed; continuing with the current version", { error }, "warn")
      this.setState({ error: undefined, updateStatus: "failed" })
    }
    this.assertNotCancelled()

    let auth = await this.readAuthState(bundle.binaryPath)
    this.assertNotCancelled()
    if (auth.connection === "disconnected" && auth.notConfigured) {
      this.setState({ phase: "configuring" })
      await this.runAuthorizationCommand(bundle.binaryPath, [
        "config",
        "init",
        "--new",
        "--brand",
        "feishu",
        "--lang",
        "zh",
      ])
      this.assertNotCancelled()
      auth = await this.readAuthState(bundle.binaryPath)
    }
    if (auth.connection !== "connected") {
      this.setState({ phase: "authorizing" })
      await this.runAuthorizationCommand(bundle.binaryPath, ["auth", "login", "--recommend", "--json"])
      this.assertNotCancelled()
    }

    this.setState({ phase: "verifying" })
    auth = await this.readAuthState(bundle.binaryPath, true)
    if (auth.connection !== "connected")
      throw new Error("Lark CLI authorization did not produce a usable user identity.")
    this.state = {
      ...this.state,
      accountLabel: auth.accountLabel,
      activeVersion: bundle.version,
      available: true,
      connection: "connected",
      error: undefined,
      phase: "idle",
    }
    this.stateChanged.emit(this.state)
    void Promise.resolve(this.onRuntimeChanged?.()).catch(() => undefined)
    return this.state
  }

  private async disconnectNow(): Promise<LarkCliState> {
    const bundle = await this.resolveActiveBundle()
    this.setState({ phase: "disconnecting" })
    await this.runCommand(bundle.binaryPath, ["auth", "logout"], authorizationTimeoutMs)
    this.state = {
      ...this.state,
      accountLabel: undefined,
      connection: "disconnected",
      error: undefined,
      phase: "idle",
    }
    this.stateChanged.emit(this.state)
    void Promise.resolve(this.onRuntimeChanged?.()).catch(() => undefined)
    return this.state
  }

  private setState(patch: Partial<LarkCliState>): void {
    this.state = { ...this.state, ...patch }
    this.stateChanged.emit(this.state)
  }

  private assertNotCancelled(): void {
    if (this.cancelRequested) throw new Error("Lark CLI connection was cancelled.")
  }

  private commandEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      LARKSUITE_CLI_CONFIG_DIR: path.join(this.rootDir, "config"),
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    }
  }

  private async readAuthState(
    binaryPath: string,
    verify = false,
  ): Promise<{
    accountLabel?: string
    connection: LarkCliState["connection"]
    notConfigured: boolean
  }> {
    try {
      const result = await this.runCommand(
        binaryPath,
        ["auth", "status", "--json", ...(verify ? ["--verify"] : [])],
        15_000,
      )
      const value = JSON.parse(result.stdout) as Record<string, unknown>
      const identity = typeof value.identity === "string" ? value.identity : "none"
      const verified = value.verified
      if (identity === "user") {
        return {
          accountLabel: identityLabel(value),
          connection: verified === false ? "expired" : "connected",
          notConfigured: false,
        }
      }
      return { connection: "disconnected", notConfigured: false }
    } catch (error) {
      const message = errorMessage(error)
      return {
        connection: "disconnected",
        notConfigured: /not configured|config init|configuration.*missing/iu.test(message),
      }
    }
  }

  private async runAuthorizationCommand(binaryPath: string, args: string[]): Promise<void> {
    await mkdir(path.join(this.rootDir, "config"), { recursive: true, mode: 0o700 })
    const child = spawn(binaryPath, args, {
      env: this.commandEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    this.activeChild = child
    let output = ""
    let openedUrl: string | undefined
    const capture = (chunk: Buffer): void => {
      output = `${output}${chunk.toString("utf-8")}`.slice(-maxOutputBytes)
      if (openedUrl) return
      const url = findOfficialAuthorizationUrl(output)
      if (!url) return
      openedUrl = url
      this.openExternalUrl(url)
    }
    child.stdout.on("data", capture)
    child.stderr.on("data", capture)
    const timeout = setTimeout(() => child.kill(), authorizationTimeoutMs)
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject)
        child.once("exit", (code, signal) => {
          if (code === 0) resolve()
          else reject(new Error(redactCommandError(output, code, signal)))
        })
      })
    } finally {
      clearTimeout(timeout)
      if (this.activeChild === child) this.activeChild = null
    }
  }

  private async runCommand(binaryPath: string, args: string[], timeout: number): Promise<CommandResult> {
    try {
      return await execFileAsync(binaryPath, args, {
        encoding: "utf-8",
        env: this.commandEnvironment(),
        maxBuffer: maxOutputBytes,
        timeout,
      })
    } catch (error) {
      const candidate = error as Error & { stderr?: string; stdout?: string }
      throw new Error(redactCommandError(`${candidate.stderr ?? ""}\n${candidate.stdout ?? ""}\n${candidate.message}`))
    }
  }

  private async readVersion(binaryPath: string): Promise<string> {
    const result = await this.runCommand(binaryPath, ["--version"], 10_000)
    const version = `${result.stdout}\n${result.stderr}`.match(/\b(?:v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1]
    if (!version) throw new Error("Lark CLI returned an unreadable version.")
    return version
  }

  private async resolveActiveBundle(): Promise<ActiveBundle> {
    const persisted = await this.readActiveMarker()
    if (persisted) {
      const root = path.join(this.rootDir, "runtime", "versions", persisted.activeVersion)
      const bundle = {
        binaryPath: path.join(root, binaryName(this.platform)),
        skillsDir: path.join(root, "skills"),
        source: "managed" as const,
        version: persisted.activeVersion,
      }
      if (await bundleReady(bundle)) return bundle
    }
    const bundled: ActiveBundle = {
      binaryPath: this.bundledBinaryPath,
      skillsDir: this.bundledSkillsDir,
      source: "bundled",
      version: await this.readVersion(this.bundledBinaryPath),
    }
    if (!(await bundleReady(bundled))) throw new Error("The bundled Lark CLI runtime is unavailable.")
    return bundled
  }

  private async installLatestIfAvailable(current: ActiveBundle): Promise<ActiveBundle> {
    const latest = await this.fetchLatestVersion()
    if (!isVersionNewer(latest, current.version)) {
      this.setState({ latestVersion: latest, updateStatus: "current" })
      return current
    }
    this.setState({ latestVersion: latest, phase: "updating", updateStatus: "updating" })
    const installed = await this.downloadBundle(latest)
    await atomicWriteText(
      path.join(this.rootDir, "runtime", "current.json"),
      `${JSON.stringify({ activeVersion: latest, version: 1 } satisfies PersistedActiveBundle, null, 2)}\n`,
      { mode: 0o600 },
    )
    this.setState({ activeVersion: latest, updateStatus: "updated" })
    void Promise.resolve(this.onRuntimeChanged?.()).catch(() => undefined)
    return installed
  }

  private async fetchLatestVersion(): Promise<string> {
    const response = await this.fetch(npmLatestUrl, { signal: AbortSignal.timeout(updateCheckTimeoutMs) })
    if (!response.ok) throw new Error(`Lark CLI update check failed with HTTP ${response.status}.`)
    const value = (await response.json()) as { version?: unknown }
    if (typeof value.version !== "string" || !parseVersion(value.version)) {
      throw new Error("Lark CLI update check returned an invalid version.")
    }
    return value.version
  }

  private async downloadBundle(version: string): Promise<ActiveBundle> {
    const target = releaseTarget(version, this.platform, this.arch)
    const base = `${officialReleaseBase}/v${version}`
    const [archive, checksums] = await Promise.all([
      this.fetchDownload(`${base}/${target.assetName}`),
      this.fetchDownload(`${base}/checksums.txt`),
    ])
    const expected = checksumForAsset(checksums.toString("utf-8"), target.assetName)
    const actual = createHash("sha256").update(archive).digest("hex")
    if (!expected || actual !== expected)
      throw new Error(`Lark CLI checksum verification failed for ${target.assetName}.`)
    const binary =
      target.kind === "zip"
        ? extractZipFile(archive, target.binaryName)
        : extractTarFile(gunzipSync(archive), target.binaryName)
    if (!binary) throw new Error(`Lark CLI binary is missing from ${target.assetName}.`)

    const versionsRoot = path.join(this.rootDir, "runtime", "versions")
    const finalDir = path.join(versionsRoot, version)
    const staging = path.join(this.rootDir, "runtime", `staging-${version}-${Date.now()}`)
    await mkdir(staging, { recursive: true, mode: 0o700 })
    const binaryPath = path.join(staging, target.binaryName)
    try {
      await writeFile(binaryPath, binary)
      await chmod(binaryPath, 0o755)
      await this.exportSkills(binaryPath, path.join(staging, "skills"))
      const actualVersion = await this.readVersion(binaryPath)
      if (actualVersion !== version)
        throw new Error(`Downloaded Lark CLI reports ${actualVersion}, expected ${version}.`)
      await mkdir(versionsRoot, { recursive: true, mode: 0o700 })
      await rm(finalDir, { force: true, recursive: true })
      await rename(staging, finalDir)
    } finally {
      await rm(staging, { force: true, recursive: true })
    }
    return {
      binaryPath: path.join(finalDir, target.binaryName),
      skillsDir: path.join(finalDir, "skills"),
      source: "managed",
      version,
    }
  }

  private async fetchDownload(url: string): Promise<Buffer> {
    const response = await this.fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) })
    if (!response.ok) throw new Error(`Lark CLI download failed with HTTP ${response.status}.`)
    const length = Number(response.headers.get("content-length") ?? "0")
    if (length > maxDownloadBytes) throw new Error("Lark CLI download exceeded the size limit.")
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxDownloadBytes) throw new Error("Lark CLI download exceeded the size limit.")
    return bytes
  }

  private async exportSkills(binaryPath: string, destination: string): Promise<void> {
    const listing = JSON.parse((await this.runCommand(binaryPath, ["skills", "list", "--json"], 30_000)).stdout) as {
      skills?: Array<{ name?: unknown }>
    }
    const names = (listing.skills ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string" && /^lark-[a-z0-9-]+$/u.test(name))
    if (names.length === 0) throw new Error("Lark CLI did not expose embedded skills.")
    await mkdir(destination, { recursive: true, mode: 0o700 })
    for (const name of names) await this.exportSkillDirectory(binaryPath, name, "", destination)
  }

  private async exportSkillDirectory(
    binaryPath: string,
    skill: string,
    relative: string,
    destination: string,
  ): Promise<void> {
    const target = `${skill}${relative ? `/${relative}` : ""}`
    const listed = JSON.parse(
      (await this.runCommand(binaryPath, ["skills", "list", target, "--json"], 30_000)).stdout,
    ) as {
      entries?: SkillDirectoryEntry[]
    }
    for (const entry of listed.entries ?? []) {
      if (typeof entry.path !== "string" || !entry.path.startsWith(`${skill}/`)) continue
      const entryRelative = entry.path.slice(skill.length + 1)
      if (!safeRelativePath(entryRelative)) continue
      if (entry.is_dir) {
        await this.exportSkillDirectory(binaryPath, skill, entryRelative, destination)
        continue
      }
      const read = JSON.parse(
        (await this.runCommand(binaryPath, ["skills", "read", skill, entryRelative, "--json"], 30_000)).stdout,
      ) as {
        content?: unknown
      }
      if (typeof read.content !== "string") throw new Error(`Lark CLI returned no content for ${entry.path}.`)
      const output = path.join(destination, skill, entryRelative)
      await mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
      await writeFile(output, read.content, "utf-8")
    }
  }

  private async readActiveMarker(): Promise<PersistedActiveBundle | null> {
    try {
      const value = JSON.parse(await readFile(path.join(this.rootDir, "runtime", "current.json"), "utf-8")) as Record<
        string,
        unknown
      >
      return value.version === 1 && typeof value.activeVersion === "string"
        ? { activeVersion: value.activeVersion, version: 1 }
        : null
    } catch {
      return null
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function identityLabel(value: Record<string, unknown>): string | undefined {
  const identities = value.identities
  if (!identities || typeof identities !== "object" || Array.isArray(identities)) return undefined
  const user = (identities as Record<string, unknown>).user
  if (!user || typeof user !== "object" || Array.isArray(user)) return undefined
  const item = user as Record<string, unknown>
  for (const key of ["userName", "name", "display_name", "email", "openId", "open_id"]) {
    if (typeof item[key] === "string" && item[key]) return item[key]
  }
  return undefined
}

export function findOfficialAuthorizationUrl(output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[^\s"'<>]+/gu)) {
    const raw = decodeJsonUrlEscapes(match[0].replace(/[),.;]+$/u, ""))
    try {
      const url = new URL(raw)
      if (isOfficialLarkHost(url.hostname) && (!url.port || url.port === "443")) return raw
    } catch {
      // Ignore partial output until a complete URL arrives.
    }
  }
  return undefined
}

function decodeJsonUrlEscapes(value: string): string {
  return value.replaceAll(/\\u([0-9a-f]{4})/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
}

function isOfficialLarkHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === "feishu.cn" || host.endsWith(".feishu.cn") || host === "larksuite.com" || host.endsWith(".larksuite.com")
  )
}

function redactCommandError(output: string, code?: number | null, signal?: NodeJS.Signals | null): string {
  const redacted = output
    .replaceAll(/https:\/\/[^\s"'<>]+/gu, "[authorization-url]")
    .replaceAll(/("?(?:device_code|app_secret|access_token|refresh_token)"?\s*[:=]\s*)[^\s,}\]]+/giu, "$1[redacted]")
    .trim()
  const suffix = code === undefined ? "" : ` (exit ${code ?? "null"}${signal ? `, ${signal}` : ""})`
  return `${redacted || "Lark CLI command failed"}${suffix}`
}

function parseVersion(input: string): [number, number, number, string[]] | null {
  const match = input.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/u)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.split(".") ?? []]
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const left = parseVersion(candidate)
  const right = parseVersion(current)
  if (!left) return false
  if (!right) return true
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] as number) !== (right[index] as number)) return (left[index] as number) > (right[index] as number)
  }
  const leftPre = left[3]
  const rightPre = right[3]
  if (leftPre.length === 0 || rightPre.length === 0) return leftPre.length === 0 && rightPre.length > 0
  return leftPre.join(".").localeCompare(rightPre.join("."), undefined, { numeric: true }) > 0
}

function releaseTarget(version: string, platform: NodeJS.Platform, arch: string) {
  const upstreamArch = arch === "x64" ? "amd64" : arch
  if (!new Set(["amd64", "arm64", "riscv64"]).has(upstreamArch))
    throw new Error(`Unsupported Lark CLI architecture: ${arch}`)
  if (platform === "darwin" && upstreamArch !== "riscv64") {
    return {
      assetName: `lark-cli-${version}-darwin-${upstreamArch}.tar.gz`,
      binaryName: "lark-cli",
      kind: "tar" as const,
    }
  }
  if (platform === "linux") {
    return {
      assetName: `lark-cli-${version}-linux-${upstreamArch}.tar.gz`,
      binaryName: "lark-cli",
      kind: "tar" as const,
    }
  }
  if (platform === "win32" && upstreamArch !== "riscv64") {
    return {
      assetName: `lark-cli-${version}-windows-${upstreamArch}.zip`,
      binaryName: "lark-cli.exe",
      kind: "zip" as const,
    }
  }
  throw new Error(`Unsupported Lark CLI platform: ${platform} ${arch}`)
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "lark-cli.exe" : "lark-cli"
}

function checksumForAsset(checksums: string, assetName: string): string | null {
  for (const line of checksums.split(/\r?\n/u)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/iu)
    if (match?.[2] === assetName) return match[1]?.toLowerCase() ?? null
  }
  return null
}

async function bundleReady(bundle: ActiveBundle): Promise<boolean> {
  try {
    const [binary, skills] = await Promise.all([stat(bundle.binaryPath), readdir(bundle.skillsDir)])
    return binary.isFile() && skills.some((name) => name.startsWith("lark-"))
  } catch {
    return false
  }
}

function safeRelativePath(value: string): boolean {
  return Boolean(value) && !value.split(/[\\/]/u).includes("..") && !path.isAbsolute(value)
}

function extractTarFile(tar: Buffer, wantedPath: string): Buffer | null {
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(tarString(header, 124, 12).trim() || "0", 8)
    const dataStart = offset + 512
    if (fullName === wantedPath) {
      if (dataStart + size > tar.length) throw new Error("Truncated Lark CLI archive.")
      return tar.subarray(dataStart, dataStart + size)
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return null
}

function tarString(header: Buffer, start: number, length: number): string {
  const value = header.subarray(start, start + length)
  const nul = value.indexOf(0)
  return value.toString("utf-8", 0, nul === -1 ? length : nul)
}

function extractZipFile(zip: Buffer, wantedPath: string): Buffer | null {
  let eocd = -1
  for (let offset = zip.length - 22; offset >= 0 && offset >= zip.length - 65_557; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error("Invalid Lark CLI zip archive.")
  const count = zip.readUInt16LE(eocd + 10)
  let central = zip.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(central) !== 0x02014b50) throw new Error("Invalid Lark CLI zip directory.")
    const method = zip.readUInt16LE(central + 10)
    const compressedSize = zip.readUInt32LE(central + 20)
    const nameLength = zip.readUInt16LE(central + 28)
    const extraLength = zip.readUInt16LE(central + 30)
    const commentLength = zip.readUInt16LE(central + 32)
    const localOffset = zip.readUInt32LE(central + 42)
    const name = zip.toString("utf-8", central + 46, central + 46 + nameLength)
    if (name === wantedPath) {
      const localNameLength = zip.readUInt16LE(localOffset + 26)
      const localExtraLength = zip.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = zip.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data)
      throw new Error(`Unsupported Lark CLI zip compression method ${method}.`)
    }
    central += 46 + nameLength + extraLength + commentLength
  }
  return null
}
