import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { gunzipSync } from "node:zlib"
import { fetchWithRetry } from "./network-download.ts"
import { extractFileFromTar } from "./oo-cli.ts"
import { extractFileFromZip } from "./ripgrep.ts"

const execFileAsync = promisify(execFile)
const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")

export const LARK_CLI_VERSION = "1.0.81"
export const localLarkCliBinDir = path.join(repoRoot, ".lark-cli-bin")
export const bundledLarkSkillsDir = path.join(repoRoot, "resources", "lark-skills")

interface LarkCliTarget {
  archiveKind: "tar.gz" | "zip"
  assetName: string
  binaryName: string
}

interface SkillListEntry {
  name?: string
}

interface SkillDirectoryEntry {
  is_dir?: boolean
  path?: string
}

export function larkCliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "lark-cli.exe" : "lark-cli"
}

export function localLarkCliBinPath(platform: NodeJS.Platform = process.platform): string {
  return path.join(localLarkCliBinDir, larkCliBinaryName(platform))
}

export function resolveLarkCliTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): LarkCliTarget {
  const binaryName = larkCliBinaryName(platform)
  const upstreamArch = arch === "x64" ? "amd64" : arch
  if (upstreamArch !== "amd64" && upstreamArch !== "arm64" && !(platform === "linux" && upstreamArch === "riscv64")) {
    throw new Error(`No prebuilt Lark CLI binary is available for ${platform} ${arch}.`)
  }
  if (platform === "darwin") {
    return {
      archiveKind: "tar.gz",
      assetName: `lark-cli-${LARK_CLI_VERSION}-darwin-${upstreamArch}.tar.gz`,
      binaryName,
    }
  }
  if (platform === "linux") {
    return {
      archiveKind: "tar.gz",
      assetName: `lark-cli-${LARK_CLI_VERSION}-linux-${upstreamArch}.tar.gz`,
      binaryName,
    }
  }
  if (platform === "win32" && upstreamArch !== "riscv64") {
    return {
      archiveKind: "zip",
      assetName: `lark-cli-${LARK_CLI_VERSION}-windows-${upstreamArch}.zip`,
      binaryName,
    }
  }
  throw new Error(`No prebuilt Lark CLI binary is available for ${platform} ${arch}.`)
}

function releaseAssetUrl(name: string): string {
  return `https://github.com/larksuite/cli/releases/download/v${LARK_CLI_VERSION}/${name}`
}

function checksumForAsset(checksums: string, assetName: string): string | null {
  for (const line of checksums.split(/\r?\n/u)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/iu)
    if (match?.[2] === assetName) return match[1]?.toLowerCase() ?? null
  }
  return null
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetchWithRetry(url)
  if (!response.ok) throw new Error(`download Lark CLI failed: HTTP ${response.status} ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function isPinnedBinaryReady(dest: string, marker: string): Promise<boolean> {
  try {
    await stat(dest)
    return (await readFile(marker, "utf-8")).trim() === LARK_CLI_VERSION
  } catch {
    return false
  }
}

export async function downloadLarkCliBinary(): Promise<string> {
  const target = resolveLarkCliTarget()
  const dest = localLarkCliBinPath()
  const marker = path.join(localLarkCliBinDir, ".version")
  if (await isPinnedBinaryReady(dest, marker)) return dest

  const [archive, checksums] = await Promise.all([
    fetchBytes(releaseAssetUrl(target.assetName)),
    fetchBytes(releaseAssetUrl("checksums.txt")),
  ])
  const expected = checksumForAsset(checksums.toString("utf-8"), target.assetName)
  const actual = createHash("sha256").update(archive).digest("hex")
  if (!expected || expected !== actual) {
    throw new Error(`sha256 mismatch for ${target.assetName}: expected ${expected ?? "<missing>"}, got ${actual}`)
  }
  const binary =
    target.archiveKind === "zip"
      ? extractFileFromZip(archive, target.binaryName)
      : extractFileFromTar(gunzipSync(archive), target.binaryName)
  if (!binary) throw new Error(`Lark CLI binary not found inside ${target.assetName}`)

  await mkdir(localLarkCliBinDir, { recursive: true })
  const temporary = `${dest}.download`
  try {
    await writeFile(temporary, binary)
    await chmod(temporary, 0o755)
    await rename(temporary, dest)
  } finally {
    await rm(temporary, { force: true })
  }
  await writeFile(marker, `${LARK_CLI_VERSION}\n`, "utf-8")
  return dest
}

async function runJson(binary: string, args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(binary, args, {
    encoding: "utf-8",
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout) as unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

async function exportSkillDirectory(binary: string, skillName: string, relativePath: string, outputRoot: string) {
  const listed = record(
    await runJson(binary, ["skills", "list", `${skillName}${relativePath ? `/${relativePath}` : ""}`, "--json"]),
  )
  const entries = Array.isArray(listed?.entries) ? (listed.entries as SkillDirectoryEntry[]) : []
  for (const entry of entries) {
    if (typeof entry.path !== "string" || !entry.path) continue
    const entryRelative = entry.path.startsWith(`${skillName}/`) ? entry.path.slice(skillName.length + 1) : entry.path
    if (!entryRelative || entryRelative.includes("..") || path.isAbsolute(entryRelative)) continue
    if (entry.is_dir) {
      await exportSkillDirectory(binary, skillName, entryRelative, outputRoot)
      continue
    }
    const content = record(await runJson(binary, ["skills", "read", skillName, entryRelative, "--json"]))?.content
    if (typeof content !== "string") throw new Error(`Lark CLI returned no content for ${skillName}/${entryRelative}`)
    const output = path.join(outputRoot, skillName, entryRelative)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, content, "utf-8")
  }
}

export async function exportLarkCliSkills(outputRoot: string = bundledLarkSkillsDir): Promise<string> {
  const binary = await downloadLarkCliBinary()
  const listing = record(await runJson(binary, ["skills", "list", "--json"]))
  const skillNames = (Array.isArray(listing?.skills) ? (listing.skills as SkillListEntry[]) : [])
    .map((skill) => skill.name)
    .filter((name): name is string => typeof name === "string" && /^lark-[a-z0-9-]+$/u.test(name))
  if (skillNames.length === 0) throw new Error("Lark CLI did not expose any embedded skills")

  const staging = `${outputRoot}.staging`
  await rm(staging, { force: true, recursive: true })
  await mkdir(staging, { recursive: true })
  try {
    for (const skillName of skillNames) await exportSkillDirectory(binary, skillName, "", staging)
    await rm(outputRoot, { force: true, recursive: true })
    await rename(staging, outputRoot)
  } finally {
    await rm(staging, { force: true, recursive: true })
  }
  await writeFile(path.join(outputRoot, ".version"), `${LARK_CLI_VERSION}\n`, "utf-8")
  return outputRoot
}
