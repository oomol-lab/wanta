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
  "0h4qxnHT3KUgNgzgUzwczZfnS0oKv9hc9mUPphJUZerqYjg6LtWtOvJRgFiMMCo9TfSmcx5/NfoItO7d1xmeVQ=="

export const DINGTALK_CLI_VERSION = "1.0.55"
const DINGTALK_CLI_CHECKSUMS: Readonly<Record<string, string>> = {
  "dws-darwin-amd64.tar.gz": "f465eb7ac38a8a84eac4eb821fd15424bfc6f6245a60fa695ba97a639970dd77",
  "dws-darwin-arm64.tar.gz": "dd753bbd051e5dd007cf433b8aa211c4a221dd73dfcb0b3783fa924d09f12351",
  "dws-linux-amd64.tar.gz": "051ba404a5f6a8fb15def0e0f5d9d273cf9d63f881df2fffe159f2c4ea3366e7",
  "dws-linux-arm64.tar.gz": "5961be0fd551ec8e69b6fff2b1609f73486f7e6c3ffe8eb4bb99fa1ed691b401",
  "dws-windows-amd64.zip": "9e273fa5f069a2606921aa5d325849a2245a1bb6d81329f5aa02376421c2330c",
  "dws-windows-arm64.zip": "2c417f8957b683d5e354fefeb9f06115bb020f957dbb3c4dbe078b2d1275e3f0",
  "dws-skills.zip": "bd35f674f184001f5a03c7b5fa6029ebcda54f0054e15cd608b5b5e213ce2d05",
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
  const response = await fetchWithRetry(url)
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
