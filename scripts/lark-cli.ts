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

export const LARK_CLI_VERSION = "1.0.98"
const LARK_CLI_CHECKSUMS: Readonly<Record<string, string>> = {
  "lark-cli-1.0.98-darwin-amd64.tar.gz": "44a4ff98e969385fc4bb4d701735ba319307e50560fa6c4c956178d70ccc3525",
  "lark-cli-1.0.98-darwin-arm64.tar.gz": "ee4a3209bbf8b74ea5c00a07d0da89b79f5e7f6abfd518a8b2d78a7a4f7e3f40",
  "lark-cli-1.0.98-linux-amd64.tar.gz": "4a12dcb7a0aab25986d8bcd046cb45b08278531a9aac3a12b53cf3d94738fe80",
  "lark-cli-1.0.98-linux-arm64.tar.gz": "f798b26ce4b369d70411945e7f66bbe4382c411bc47d81950a662de7b69b41ed",
  "lark-cli-1.0.98-linux-riscv64.tar.gz": "068d5618ba8d42c129bd382a7374e5502263f358066391155d1af4508c238579",
  "lark-cli-1.0.98-windows-amd64.zip": "b13a5d710f9afe327b34bfe68c4a736a574d4d97274f6da862e912dfada1ccdc",
  "lark-cli-1.0.98-windows-arm64.zip": "6a111ccfed1f89eca95fbf7a9ef0ae941b9017409a864bf6cd93becc430dc810",
}
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

  const archive = await fetchBytes(releaseAssetUrl(target.assetName))
  const expected = LARK_CLI_CHECKSUMS[target.assetName]
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

async function exportSkillDirectory(
  binary: string,
  skillName: string,
  relativePath: string,
  outputRoot: string,
  visited: Set<string>,
) {
  const target = `${skillName}${relativePath ? `/${relativePath}` : ""}`
  if (visited.has(target)) throw new Error(`Lark CLI skill directory cycle detected at ${target}`)
  visited.add(target)
  const listed = record(await runJson(binary, ["skills", "list", target, "--json"]))
  const entries = Array.isArray(listed?.entries) ? (listed.entries as SkillDirectoryEntry[]) : []
  for (const entry of entries) {
    if (typeof entry.path !== "string" || !entry.path) continue
    const entryRelative = entry.path.startsWith(`${skillName}/`) ? entry.path.slice(skillName.length + 1) : entry.path
    if (!entryRelative || entryRelative.includes("..") || path.isAbsolute(entryRelative)) continue
    if (entry.is_dir) {
      await exportSkillDirectory(binary, skillName, entryRelative, outputRoot, visited)
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
  try {
    if ((await readFile(path.join(outputRoot, ".version"), "utf-8")).trim() === LARK_CLI_VERSION) return outputRoot
  } catch {
    // Missing or stale exports are rebuilt below.
  }
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
    for (const skillName of skillNames) await exportSkillDirectory(binary, skillName, "", staging, new Set())
    await rm(outputRoot, { force: true, recursive: true })
    await rename(staging, outputRoot)
  } finally {
    await rm(staging, { force: true, recursive: true })
  }
  await writeFile(path.join(outputRoot, ".version"), `${LARK_CLI_VERSION}\n`, "utf-8")
  return outputRoot
}
