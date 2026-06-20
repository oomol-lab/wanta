// ripgrep 平台二进制的下载与定位（供 OpenCode 内置 grep 工具使用）。
//
// OpenCode 的 grep 工具依赖 `rg` 可执行文件；Windows/Finder 启动的 GUI 进程不能假设系统 PATH
// 里存在 ripgrep。因此 dev 与打包态都把 rg 放在 oo 同一目录：AgentManager 已将该目录前置注入 PATH。

import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync, inflateRawSync } from "node:zlib"
import { extractFileFromTar } from "./oo-cli.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const localToolBinDir = path.join(repoRoot, ".oo-bin")

export const RIPGREP_VERSION = "14.1.1"

interface RipgrepTarget {
  assetName: string
  executableFileName: string
  archivePath: string
  archiveKind: "tar.gz" | "zip"
}

export function ripgrepExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "rg.exe" : "rg"
}

export function localRipgrepBinPath(platform: NodeJS.Platform = process.platform): string {
  return path.join(localToolBinDir, ripgrepExecutableName(platform))
}

export function resolveRipgrepTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): RipgrepTarget {
  const executableFileName = ripgrepExecutableName(platform)
  let triple: string
  let archiveKind: "tar.gz" | "zip" = "tar.gz"

  if (platform === "darwin") {
    if (arch === "arm64") {
      triple = "aarch64-apple-darwin"
    } else if (arch === "x64") {
      triple = "x86_64-apple-darwin"
    } else {
      throw new Error(`No prebuilt ripgrep binary is available for ${platform} ${arch}.`)
    }
  } else if (platform === "win32") {
    if (arch === "x64") {
      triple = "x86_64-pc-windows-msvc"
    } else if (arch === "ia32") {
      triple = "i686-pc-windows-msvc"
    } else {
      throw new Error(`No prebuilt ripgrep binary is available for ${platform} ${arch}.`)
    }
    archiveKind = "zip"
  } else if (platform === "linux") {
    if (arch === "arm64") {
      triple = "aarch64-unknown-linux-gnu"
    } else if (arch === "x64") {
      triple = "x86_64-unknown-linux-musl"
    } else {
      throw new Error(`No prebuilt ripgrep binary is available for ${platform} ${arch}.`)
    }
  } else {
    throw new Error(`No prebuilt ripgrep binary is available for ${platform} ${arch}.`)
  }

  const extension = archiveKind === "zip" ? "zip" : "tar.gz"
  const baseName = `ripgrep-${RIPGREP_VERSION}-${triple}`
  return {
    archiveKind,
    archivePath: `${baseName}/${executableFileName}`,
    assetName: `${baseName}.${extension}`,
    executableFileName,
  }
}

function versionTag(assetName: string): string {
  return `${assetName}@${RIPGREP_VERSION}`
}

async function isUpToDate(destPath: string, versionMarker: string, assetName: string): Promise<boolean> {
  try {
    await stat(destPath)
    const marker = (await readFile(versionMarker, "utf-8")).trim()
    return marker === versionTag(assetName)
  } catch {
    return false
  }
}

function releaseAssetUrl(assetName: string): string {
  return `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${assetName}`
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download ripgrep failed: HTTP ${response.status} ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function verifySha256(data: Buffer, shaFile: string, source: string): void {
  const expected = shaFile.trim().split(/\s+/)[0]
  const actual = createHash("sha256").update(data).digest("hex")
  if (!expected || actual !== expected) {
    throw new Error(`sha256 mismatch for ${source}: expected ${expected || "<missing>"}, got ${actual}`)
  }
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset)
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset)
}

function extractFileFromZip(zip: Buffer, wantedPath: string): Buffer | null {
  const eocdSignature = 0x06054b50
  let eocd = -1
  for (let offset = zip.length - 22; offset >= 0 && offset >= zip.length - 65557; offset -= 1) {
    if (readUInt32(zip, offset) === eocdSignature) {
      eocd = offset
      break
    }
  }
  if (eocd === -1) {
    throw new Error("invalid zip: end of central directory not found")
  }

  const entryCount = readUInt16(zip, eocd + 10)
  let centralOffset = readUInt32(zip, eocd + 16)
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(zip, centralOffset) !== 0x02014b50) {
      throw new Error("invalid zip: central directory entry not found")
    }
    const method = readUInt16(zip, centralOffset + 10)
    const compressedSize = readUInt32(zip, centralOffset + 20)
    const fileNameLength = readUInt16(zip, centralOffset + 28)
    const extraLength = readUInt16(zip, centralOffset + 30)
    const commentLength = readUInt16(zip, centralOffset + 32)
    const localHeaderOffset = readUInt32(zip, centralOffset + 42)
    const fileName = zip.toString("utf-8", centralOffset + 46, centralOffset + 46 + fileNameLength)

    if (fileName === wantedPath) {
      if (readUInt32(zip, localHeaderOffset) !== 0x04034b50) {
        throw new Error(`invalid zip: local header not found for ${wantedPath}`)
      }
      const localNameLength = readUInt16(zip, localHeaderOffset + 26)
      const localExtraLength = readUInt16(zip, localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const data = zip.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) {
        return data
      }
      if (method === 8) {
        return inflateRawSync(data)
      }
      throw new Error(`unsupported zip compression method ${method} for ${wantedPath}`)
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength
  }
  return null
}

function extractRipgrepBinary(archive: Buffer, target: RipgrepTarget): Buffer {
  const binary =
    target.archiveKind === "zip"
      ? extractFileFromZip(archive, target.archivePath)
      : extractFileFromTar(gunzipSync(archive), target.archivePath)
  if (!binary) {
    throw new Error(`ripgrep binary not found inside archive: ${target.assetName}`)
  }
  return binary
}

export async function downloadRipgrepBinary(): Promise<string> {
  const target = resolveRipgrepTarget()
  const destPath = localRipgrepBinPath()
  const versionMarker = path.join(localToolBinDir, ".ripgrep-version")

  if (await isUpToDate(destPath, versionMarker, target.assetName)) {
    return destPath
  }

  const url = releaseAssetUrl(target.assetName)
  const archive = await fetchBytes(url)
  const sha = await fetchBytes(`${url}.sha256`)
  verifySha256(archive, sha.toString("utf-8"), url)
  const binary = extractRipgrepBinary(archive, target)

  await mkdir(localToolBinDir, { recursive: true })
  const tmpPath = `${destPath}.download`
  try {
    await writeFile(tmpPath, binary)
    await chmod(tmpPath, 0o755)
    await rename(tmpPath, destPath)
  } finally {
    await rm(tmpPath, { force: true })
  }

  await writeFile(versionMarker, `${versionTag(target.assetName)}\n`, "utf-8")
  return destPath
}
