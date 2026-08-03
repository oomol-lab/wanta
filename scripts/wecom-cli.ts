import { execFile } from "node:child_process"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { gunzipSync } from "node:zlib"
import { fetchWithRetry } from "./network-download.ts"
import { extractFileFromTar, verifyTarballIntegrity } from "./oo-cli.ts"

const execFileAsync = promisify(execFile)
const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const maxDownloadBytes = 128 * 1024 * 1024

export const WECOM_CLI_VERSION = "0.1.9"
export const WECOM_CLI_GIT_HEAD = "72e14f7695f34d28f1ff23ea504ddd2210a87c13"
export const localWecomCliBinDir = path.join(repoRoot, ".wecom-cli-bin")
export const bundledWecomSkillsDir = path.join(repoRoot, "resources", "wecom-skills")

interface WecomCliTarget {
  binaryName: string
  packageName: string
}

interface PackageVersionMetadata {
  dist?: { integrity?: string; tarball?: string }
  gitHead?: string
}

interface TarEntry {
  data: Buffer
  path: string
  type: string
}

export function wecomCliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "wecom-cli.exe" : "wecom-cli"
}

export function resolveWecomCliTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): WecomCliTarget {
  const binaryName = wecomCliBinaryName(platform)
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return { binaryName, packageName: `@wecom/cli-darwin-${arch}` }
  }
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) {
    return { binaryName, packageName: `@wecom/cli-linux-${arch}` }
  }
  if (platform === "win32" && arch === "x64") {
    return { binaryName, packageName: "@wecom/cli-win32-x64" }
  }
  throw new Error(`No prebuilt WeCom CLI binary is available for ${platform} ${arch}.`)
}

export function localWecomCliBinPath(platform: NodeJS.Platform = process.platform): string {
  return path.join(localWecomCliBinDir, wecomCliBinaryName(platform))
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetchWithRetry(url)
  if (!response.ok) throw new Error(`download WeCom CLI failed: HTTP ${response.status} ${url}`)
  const length = Number(response.headers.get("content-length") ?? "0")
  if (length > maxDownloadBytes) throw new Error(`WeCom CLI download exceeded ${maxDownloadBytes} bytes`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxDownloadBytes) throw new Error(`WeCom CLI download exceeded ${maxDownloadBytes} bytes`)
  return bytes
}

async function packageMetadata(packageName: string, version: string): Promise<PackageVersionMetadata> {
  const response = await fetchWithRetry(`https://registry.npmjs.org/${packageName}`)
  if (!response.ok) throw new Error(`fetch WeCom CLI package metadata failed: HTTP ${response.status} ${packageName}`)
  const packument = (await response.json()) as { versions?: Record<string, PackageVersionMetadata> }
  const metadata = packument.versions?.[version]
  if (!metadata) throw new Error(`No npm metadata for ${packageName}@${version}`)
  return metadata
}

async function binaryReady(destination: string, marker: string, packageName: string): Promise<boolean> {
  try {
    await stat(destination)
    return (await readFile(marker, "utf-8")).trim() === `${packageName}@${WECOM_CLI_VERSION}`
  } catch {
    return false
  }
}

export async function downloadWecomCliBinary(): Promise<string> {
  const target = resolveWecomCliTarget()
  const destination = localWecomCliBinPath()
  const marker = path.join(localWecomCliBinDir, ".version")
  if (await binaryReady(destination, marker, target.packageName)) return destination

  const metadata = await packageMetadata(target.packageName, WECOM_CLI_VERSION)
  if (!metadata.dist?.tarball || !metadata.dist.integrity) {
    throw new Error(`Incomplete npm dist metadata for ${target.packageName}@${WECOM_CLI_VERSION}`)
  }
  if (metadata.gitHead !== WECOM_CLI_GIT_HEAD) {
    throw new Error(
      `${target.packageName}@${WECOM_CLI_VERSION} comes from ${metadata.gitHead ?? "an unknown commit"}; expected ${WECOM_CLI_GIT_HEAD}`,
    )
  }
  const archive = await fetchBytes(metadata.dist.tarball)
  verifyTarballIntegrity(archive, metadata.dist.integrity, metadata.dist.tarball)
  const binary = extractFileFromTar(gunzipSync(archive), `package/bin/${target.binaryName}`)
  if (!binary) throw new Error(`WeCom CLI binary is missing from ${target.packageName}@${WECOM_CLI_VERSION}`)

  await mkdir(localWecomCliBinDir, { recursive: true })
  const temporary = `${destination}.download`
  try {
    await writeFile(temporary, binary)
    await chmod(temporary, 0o755)
    const result = await execFileAsync(temporary, ["--version"], { encoding: "utf-8", timeout: 10_000 })
    const reported = `${result.stdout}\n${result.stderr}`.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1]
    if (reported !== WECOM_CLI_VERSION) {
      throw new Error(
        `Downloaded WeCom CLI reports ${reported ?? "an unreadable version"}; expected ${WECOM_CLI_VERSION}`,
      )
    }
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  await writeFile(marker, `${target.packageName}@${WECOM_CLI_VERSION}\n`, "utf-8")
  return destination
}

function tarString(header: Buffer, start: number, length: number): string {
  const value = header.subarray(start, start + length)
  const nul = value.indexOf(0)
  return value.toString("utf-8", 0, nul === -1 ? length : nul)
}

export function tarEntries(tar: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const entryPath = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(tarString(header, 124, 12).trim() || "0", 8)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    const nextOffset = dataStart + Math.ceil(size / 512) * 512
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > tar.length || nextOffset > tar.length) {
      throw new Error(`Invalid or truncated WeCom CLI source archive entry: ${entryPath}`)
    }
    entries.push({
      data: tar.subarray(dataStart, dataEnd),
      path: entryPath,
      type: String.fromCharCode(header[156] ?? 0),
    })
    offset = nextOffset
  }
  return entries
}

export function safeSkillPath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  const segments = value.split(/[\\/]/u)
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

export async function exportWecomCliSkills(outputRoot: string = bundledWecomSkillsDir): Promise<string> {
  const commit = WECOM_CLI_GIT_HEAD
  const expectedMarker = `${WECOM_CLI_VERSION}@${commit}`
  try {
    if ((await readFile(path.join(outputRoot, ".version"), "utf-8")).trim() === expectedMarker) return outputRoot
  } catch {
    // Missing or stale exports are rebuilt below.
  }

  const archive = await fetchBytes(`https://codeload.github.com/WecomTeam/wecom-cli/tar.gz/${commit}`)
  const entries = tarEntries(gunzipSync(archive))
  const skillFiles = entries.flatMap((entry) => {
    const marker = "/skills/"
    const markerIndex = entry.path.indexOf(marker)
    if (markerIndex === -1 || (entry.type !== "0" && entry.type !== "\0")) return []
    const relative = entry.path.slice(markerIndex + marker.length)
    const skillName = relative.split("/")[0]
    if (!skillName || !/^wecomcli-[a-z0-9-]+$/u.test(skillName) || !safeSkillPath(relative)) return []
    return [{ data: entry.data, relative, skillName }]
  })
  const skillNames = new Set(skillFiles.map((entry) => entry.skillName))
  for (const skillName of skillNames) {
    if (!skillFiles.some((entry) => entry.relative === `${skillName}/SKILL.md`)) {
      throw new Error(`Official WeCom skill ${skillName} has no SKILL.md`)
    }
  }
  if (skillNames.size === 0) throw new Error("Official WeCom CLI source contains no wecomcli-* skills")

  const staging = `${outputRoot}.staging`
  await rm(staging, { force: true, recursive: true })
  await mkdir(staging, { recursive: true })
  try {
    for (const entry of skillFiles) {
      const destination = path.join(staging, entry.relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, entry.data)
    }
    await writeFile(path.join(staging, ".version"), `${expectedMarker}\n`, "utf-8")
    await rm(outputRoot, { force: true, recursive: true })
    await rename(staging, outputRoot)
  } finally {
    await rm(staging, { force: true, recursive: true })
  }
  return outputRoot
}
