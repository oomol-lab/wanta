import JSZip from "jszip"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { gunzipSync } from "node:zlib"
import { fetchWithRetry } from "./network-download.ts"
import { extractFileFromTar } from "./oo-cli.ts"

const execFileAsync = promisify(execFile)
const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const maxDownloadBytes = 128 * 1024 * 1024
const DINGTALK_CLI_NPM_INTEGRITY =
  "f/dqjtpeUF9lz/uunqkgLerB1YoiXBVeM69QocjlFQeNhBYDdWI2isCRG6lzfilSVGDfm5Xp5IZvcrrsweUM3g=="

export const DINGTALK_CLI_VERSION = "1.0.59"
const DINGTALK_CLI_CHECKSUMS: Readonly<Record<string, string>> = {
  "dws-darwin-amd64.tar.gz": "fd14b0b1a1475891fb243bf6453857a1044ab5a40bcf7dc1c7c795f57e5b03ba",
  "dws-darwin-arm64.tar.gz": "61135a2a9286204ce060847e653c63c1e9784a0fa631bb7e0563b90628762a35",
  "dws-linux-amd64.tar.gz": "be1eb9a1f8fc5048e578b5b0bde212fc90baca0f289236c7c333d824bd869cf3",
  "dws-linux-arm64.tar.gz": "5bfe9ac7d1798b028f0fad579bbdffec5898e2fb16ee36f5766ab58e208abd50",
  "dws-windows-amd64.zip": "5393a0d5e00c70b58833c60610ad3a772926ca5e4eb38c360928e3d2552451bc",
  "dws-windows-arm64.zip": "8c1a8eaa527a56197fd1a26d21b0f6c8b8b0e2270d1ad4c1d97519f4cab0f094",
  "dws-skills.zip": "7ce5c3ab6f6a367407f64971bc5ff96cfcdfade2c1a10d326144b17c7b25a57e",
}

export const localDingTalkCliBinDir = path.join(repoRoot, ".dingtalk-cli-bin")
export const bundledDingTalkSkillsDir = path.join(repoRoot, "resources", "dingtalk-skills")

interface DingTalkCliTarget {
  archiveKind: "tar.gz" | "zip"
  assetName: string
  binaryPath: string
}

export function dingTalkCliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "dws.exe" : "dws"
}

export function localDingTalkCliBinPath(platform: NodeJS.Platform = process.platform): string {
  return path.join(localDingTalkCliBinDir, dingTalkCliBinaryName(platform))
}

export function resolveDingTalkCliTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): DingTalkCliTarget {
  const upstreamArch = arch === "x64" ? "amd64" : arch
  if (upstreamArch !== "amd64" && upstreamArch !== "arm64") {
    throw new Error(`No prebuilt DingTalk CLI binary is available for ${platform} ${arch}.`)
  }
  if (platform === "darwin") {
    return {
      archiveKind: "tar.gz",
      assetName: `dws-${platform}-${upstreamArch}.tar.gz`,
      binaryPath: "./dws",
    }
  }
  if (platform === "linux") {
    return {
      archiveKind: "tar.gz",
      assetName: `dws-${platform}-${upstreamArch}.tar.gz`,
      binaryPath: "dws",
    }
  }
  if (platform === "win32") {
    return {
      archiveKind: "zip",
      assetName: `dws-windows-${upstreamArch}.zip`,
      binaryPath: "dws.exe",
    }
  }
  throw new Error(`No prebuilt DingTalk CLI binary is available for ${platform} ${arch}.`)
}

async function fetchBytes(url: string): Promise<Buffer> {
  // The dingtalk-workspace-cli npm package is ~66MB. The default 30s timeout
  // also aborts the body read, so it always fails on slow networks (~2MB/s).
  // Extend to 180s.
  const response = await fetchWithRetry(url, {}, { timeoutMs: 180_000 })
  if (!response.ok) throw new Error(`download DingTalk CLI failed: HTTP ${response.status} ${url}`)
  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (contentLength > maxDownloadBytes) throw new Error(`DingTalk CLI download exceeded ${maxDownloadBytes} bytes`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxDownloadBytes) throw new Error(`DingTalk CLI download exceeded ${maxDownloadBytes} bytes`)
  return bytes
}

let releasePackagePromise: Promise<Buffer> | undefined

async function releasePackage(): Promise<Buffer> {
  releasePackagePromise ??= fetchBytes(
    `https://registry.npmjs.org/dingtalk-workspace-cli/-/dingtalk-workspace-cli-${DINGTALK_CLI_VERSION}.tgz`,
  ).then((archive) => {
    const actual = createHash("sha512").update(archive).digest("base64")
    if (actual !== DINGTALK_CLI_NPM_INTEGRITY) {
      throw new Error(`sha512 mismatch for dingtalk-workspace-cli@${DINGTALK_CLI_VERSION}`)
    }
    return archive
  })
  return releasePackagePromise
}

async function releaseAsset(name: string): Promise<Buffer> {
  const asset = extractFileFromTar(gunzipSync(await releasePackage()), `package/assets/${name}`)
  if (!asset) throw new Error(`DingTalk CLI npm package has no ${name} release asset`)
  verifyChecksum(asset, name)
  return asset
}

function verifyChecksum(bytes: Buffer, assetName: string): void {
  const expected = DINGTALK_CLI_CHECKSUMS[assetName]
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (!expected || expected !== actual) {
    throw new Error(`sha256 mismatch for ${assetName}: expected ${expected ?? "<missing>"}, got ${actual}`)
  }
}

async function binaryReady(destination: string, marker: string): Promise<boolean> {
  try {
    return (await stat(destination)).isFile() && (await readFile(marker, "utf-8")).trim() === DINGTALK_CLI_VERSION
  } catch {
    return false
  }
}

async function binaryFromArchive(archive: Buffer, target: DingTalkCliTarget): Promise<Buffer> {
  if (target.archiveKind === "tar.gz") {
    const binary = extractFileFromTar(gunzipSync(archive), target.binaryPath)
    if (!binary) throw new Error(`DingTalk CLI binary not found at ${target.binaryPath}`)
    return binary
  }
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true })
  const entry = zip.file(target.binaryPath)
  if (!entry) throw new Error(`DingTalk CLI binary not found at ${target.binaryPath}`)
  return Buffer.from(await entry.async("uint8array"))
}

export async function downloadDingTalkCliBinary(): Promise<string> {
  const target = resolveDingTalkCliTarget()
  const destination = localDingTalkCliBinPath()
  const marker = path.join(localDingTalkCliBinDir, ".version")
  if (await binaryReady(destination, marker)) return destination

  const archive = await releaseAsset(target.assetName)
  const binary = await binaryFromArchive(archive, target)

  await mkdir(localDingTalkCliBinDir, { recursive: true })
  const temporary = `${destination}.download`
  try {
    await writeFile(temporary, binary)
    await chmod(temporary, 0o755)
    const result = await execFileAsync(temporary, ["version", "--format", "json"], {
      encoding: "utf-8",
      timeout: 10_000,
    })
    const parsed = JSON.parse(result.stdout) as { version?: unknown }
    const reported = typeof parsed.version === "string" ? parsed.version.replace(/^v/u, "") : ""
    if (reported !== DINGTALK_CLI_VERSION) {
      throw new Error(
        `Downloaded DingTalk CLI reports ${reported || "an unreadable version"}; expected ${DINGTALK_CLI_VERSION}`,
      )
    }
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  await writeFile(marker, `${DINGTALK_CLI_VERSION}\n`, "utf-8")
  return destination
}

export function safeDingTalkSkillPath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  return value.split(/[\\/]/u).every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

export async function exportDingTalkCliSkills(outputRoot: string = bundledDingTalkSkillsDir): Promise<string> {
  try {
    if ((await readFile(path.join(outputRoot, ".version"), "utf-8")).trim() === DINGTALK_CLI_VERSION) return outputRoot
  } catch {
    // Missing or stale exports are rebuilt below.
  }

  const archive = await releaseAsset("dws-skills.zip")
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true })
  if (!zip.file("mono/SKILL.md")) throw new Error("Official DingTalk CLI skills archive has no mono/SKILL.md")

  const staging = `${outputRoot}.staging`
  await rm(staging, { force: true, recursive: true })
  await mkdir(path.join(staging, "dws"), { recursive: true })
  try {
    for (const [entryPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue
      let relative: string | null = null
      if (entryPath === "mono/SKILL.md") relative = "SKILL.md"
      else if (entryPath.startsWith("references/") || entryPath.startsWith("scripts/")) relative = entryPath
      if (!relative || !safeDingTalkSkillPath(relative)) continue
      const destination = path.join(staging, "dws", relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, Buffer.from(await entry.async("uint8array")))
    }
    await writeFile(path.join(staging, ".version"), `${DINGTALK_CLI_VERSION}\n`, "utf-8")
    await rm(outputRoot, { force: true, recursive: true })
    await rename(staging, outputRoot)
  } finally {
    await rm(staging, { force: true, recursive: true })
  }
  return outputRoot
}
