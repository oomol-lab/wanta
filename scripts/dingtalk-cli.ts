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
  "lYLLqE3jDRqzf3ekjaOnBqD222fsbRkEiO4GsR6k8aMiybEUTQDr7BC9/4Wtm2KeL+PiukBqfZ9EFULS22jdBA=="

export const DINGTALK_CLI_VERSION = "1.0.61"
const DINGTALK_CLI_CHECKSUMS: Readonly<Record<string, string>> = {
  "dws-darwin-amd64.tar.gz": "9a5ef46566df90d2c6c0a9e43935239961fd494dc4d89ac2829c847277e86929",
  "dws-darwin-arm64.tar.gz": "9a122f6322983c45e44db7274788dbb5c62d1762268e45d18e0e72ed40d39978",
  "dws-linux-amd64.tar.gz": "a507356bc19edc4b868398bd99c803c81480c2e094b9efbb6ad74e2905089a4d",
  "dws-linux-arm64.tar.gz": "6ae66f61e36f368e017136471015b277b363dfc342edd602b5166c10d91acd5b",
  "dws-skills.zip": "24b4c48b4bf095cc8f749b60ad021716141c997f5ca38cc0883fd4f1d50f7acd",
  "dws-windows-amd64.zip": "defdcf217bddfb74254c6eeaff408f8b23dddb44729cd997b6d85aa6ce7727a0",
  "dws-windows-arm64.zip": "217beef7abd8f860ff68a8f1166103adef64758235ad17c38bab2c9eac1d1acf",
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
