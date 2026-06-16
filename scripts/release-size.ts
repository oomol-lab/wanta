#!/usr/bin/env node
// 采集 Release 构建每个产物的下载体积 + 展开体积，并渲染成 GitHub Release notes
// 里的 Markdown Downloads 表格。两个子命令：
//
//   collect —— 在各平台构建 runner 上、electron-builder 之后运行。读取本地
//     `release/<version>/` 产物，写出小体积的 `release-size-<platform>-<arch>.json`
//     元数据文件，作为 GitHub Actions artifact 上传，供 `create-release` job 消费，
//     无需重新下载大体积安装包。
//
//   render —— 在 release runner 上运行。读取 --metadata-dir 下所有采集到的元数据，
//     输出注入 GitHub Release body 的 Markdown 表格。任一必需平台元数据缺失即
//     快速失败；我们刻意不静默降级成 "—"，因为"Release notes 缺一半体积数据"
//     正是规划阶段被否决的失败模式。
//
// 体积口径，跨平台保持一致：
//   - 下载体积 = installer/zip 文件的 `stat.size`（表观字节）。
//   - 展开体积 = 解包 app payload 目录下文件 `stat.size` 的递归求和（表观字节）。
//                macOS 是 `mac-<arch>/Lumo.app`；Windows 是 `win-unpacked`
//                （非 x64 架构为 `win-<arch>-unpacked`）。该口径与用户安装后在
//                磁盘上看到的体积（Finder 显示简介 / 资源管理器属性）一致，且
//                避免在签名 runner 上跑 NSIS 安装器或用 `hdiutil` 挂载 DMG。

import type { Dirent } from "node:fs"

import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

const BYTES_PER_MIB = 1024 * 1024

type ReleasePlatform = "darwin" | "win32"

interface ReleaseArtifactMetadata {
  artifact: string
  fileName: string
  downloadBytes: number
  expandedBytes: number
  expandedLabel: string
}

export interface ReleaseSizeMetadata {
  version: string
  platform: ReleasePlatform
  arch: string
  artifacts: ReleaseArtifactMetadata[]
}

interface CollectMetadataOptions {
  version: string
  arch: string
  releaseDir: string
}

interface RenderDownloadsOptions {
  version: string
  ossBase: string
  metadata: ReleaseSizeMetadata[]
}

type CliValues = Record<string, string | boolean | undefined>

interface ReleasePlatformArch {
  platform: ReleasePlatform
  arch: string
}

const PLATFORM_DISPLAY: Record<ReleasePlatform, string> = {
  darwin: "macOS",
  win32: "Windows",
}

// 每个 Release 构建都必须产出元数据的平台+架构组合。`render` 会拒绝缺少其中任一
// 组合的 release —— 我们要 workflow 大声失败，而不是发出一张缺了半行的体积表。
const REQUIRED_PLATFORM_ARCH_PAIRS = [
  { platform: "darwin", arch: "arm64" },
  { platform: "win32", arch: "x64" },
] satisfies ReleasePlatformArch[]

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/**
 * 把非负字节数格式化为带一位小数的 MiB 字符串。用 base-1024（MiB）而非
 * base-1000（MB），使数字与 Finder / Windows 资源管理器对同一文件的显示一致。
 */
export function formatMiB(bytes: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    throw new TypeError(`formatMiB expects a non-negative finite number, got ${bytes}`)
  }
  return `${(bytes / BYTES_PER_MIB).toFixed(1)} MiB`
}

/**
 * 递归求和 `dir` 下文件的 `stat.size`（表观字节）。目录不存在时返回 0，让调用方
 * 自行决定"缺失"是硬错误还是预期。跳过符号链接：macOS .app bundle 里含 framework
 * Version 符号链接，指向的文件已按其真实路径计过一次。
 */
export async function sumFileBytesRecursive(dir: string): Promise<number> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return 0
    throw error
  }
  let total = 0
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isFile()) {
      const stats = await stat(entryPath)
      total += stats.size
    } else if (entry.isDirectory()) {
      total += await sumFileBytesRecursive(entryPath)
    }
    // 符号链接：跳过 —— 见文件头注释。
  }
  return total
}

async function fileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath)
  return stats.size
}

function macUnpackedDirName(arch: string): string {
  // electron-builder 给 arm64 构建写 `mac-arm64/`，给 x64 写 `mac/`。
  return arch === "arm64" ? "mac-arm64" : "mac"
}

function winUnpackedDirName(arch: string): string {
  // electron-builder 给 x64 写 `win-unpacked/`，给非 x64 架构写 `win-<arch>-unpacked/`。
  return arch === "x64" ? "win-unpacked" : `win-${arch}-unpacked`
}

export async function collectMacMetadata({
  version,
  arch,
  releaseDir,
}: CollectMetadataOptions): Promise<ReleaseSizeMetadata> {
  const dmgPath = path.join(releaseDir, `Lumo-${version}.dmg`)
  const zipPath = path.join(releaseDir, `Lumo-${version}.zip`)
  const appPath = path.join(releaseDir, macUnpackedDirName(arch), "Lumo.app")

  const [dmgBytes, zipBytes, appBytes] = await Promise.all([
    fileSize(dmgPath),
    fileSize(zipPath),
    sumFileBytesRecursive(appPath),
  ])

  if (appBytes === 0) {
    throw new Error(
      `Expected macOS unpacked .app bundle at ${appPath}, but recursive size came back as 0 bytes. ` +
        `Did electron-builder produce the mac-${arch} target?`,
    )
  }

  return {
    version,
    platform: "darwin",
    arch,
    artifacts: [
      {
        artifact: "DMG",
        fileName: path.basename(dmgPath),
        downloadBytes: dmgBytes,
        expandedBytes: appBytes,
        expandedLabel: "app bundle",
      },
      {
        artifact: "ZIP",
        fileName: path.basename(zipPath),
        downloadBytes: zipBytes,
        expandedBytes: appBytes,
        expandedLabel: "app bundle",
      },
    ],
  }
}

export async function collectWinMetadata({
  version,
  arch,
  releaseDir,
}: CollectMetadataOptions): Promise<ReleaseSizeMetadata> {
  const exePath = path.join(releaseDir, `Lumo-${version}-Setup.exe`)
  const unpackedPath = path.join(releaseDir, winUnpackedDirName(arch))

  const [exeBytes, unpackedBytes] = await Promise.all([fileSize(exePath), sumFileBytesRecursive(unpackedPath)])

  if (unpackedBytes === 0) {
    throw new Error(
      `Expected Windows unpacked payload at ${unpackedPath}, but recursive size came back as 0 bytes. ` +
        `Did electron-builder produce the win-${arch} target?`,
    )
  }

  return {
    version,
    platform: "win32",
    arch,
    artifacts: [
      {
        artifact: "Setup EXE",
        fileName: path.basename(exePath),
        downloadBytes: exeBytes,
        expandedBytes: unpackedBytes,
        expandedLabel: "installed app payload",
      },
    ],
  }
}

function platformDisplay({ platform, arch }: ReleasePlatformArch): string {
  const base = PLATFORM_DISPLAY[platform] ?? platform
  return `${base} ${arch}`
}

function ossUrl(ossBase: string, platform: ReleasePlatform, arch: string, fileName: string): string {
  return `${ossBase}/${platform}/${arch}/${fileName}`
}

/**
 * 从采集到的元数据渲染 Markdown Downloads 表格。任一必需平台+架构组合缺失，或某个
 * 元数据文件的 version 与 release version 不一致，即快速失败 —— 二者都表示我们想暴露、
 * 而非绕过的 CI bug。
 */
export function renderDownloadsTable({ version, ossBase, metadata }: RenderDownloadsOptions): string {
  const byKey = new Map<string, ReleaseSizeMetadata>()
  for (const entry of metadata) {
    if (entry.version !== version) {
      throw new Error(
        `Release size metadata version mismatch: expected ${version}, ` +
          `got ${entry.version} for ${entry.platform}/${entry.arch}`,
      )
    }
    byKey.set(`${entry.platform}:${entry.arch}`, entry)
  }

  const missing: string[] = []
  for (const pair of REQUIRED_PLATFORM_ARCH_PAIRS) {
    if (!byKey.has(`${pair.platform}:${pair.arch}`)) {
      missing.push(`${pair.platform}/${pair.arch}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required release size metadata for: ${missing.join(", ")}. ` +
        `Each build job must produce a release-size-<platform>-<arch>.json artifact ` +
        `via 'release-size.ts collect'.`,
    )
  }

  const lines = [
    "| Platform | Artifact | Download Size | Expanded / Installed Size | Link |",
    "| -------- | -------- | ------------- | ------------------------- | ---- |",
  ]

  for (const pair of REQUIRED_PLATFORM_ARCH_PAIRS) {
    const entry = byKey.get(`${pair.platform}:${pair.arch}`)
    if (!entry) {
      throw new Error(`Missing release size metadata for ${pair.platform}/${pair.arch}`)
    }
    for (const artifact of entry.artifacts) {
      const url = ossUrl(ossBase, entry.platform, entry.arch, artifact.fileName)
      const download = formatMiB(artifact.downloadBytes)
      const expanded = `${formatMiB(artifact.expandedBytes)} ${artifact.expandedLabel}`
      lines.push(
        `| ${platformDisplay(entry)} | ${artifact.artifact} | ${download} | ${expanded} | [Download](${url}) |`,
      )
    }
  }

  return lines.join("\n")
}

/**
 * 递归查找目录下的 `release-size-*.json` 文件。兼容 `actions/download-artifact` 两种
 * 布局：扁平（merge-multiple=true）与按 artifact 分子目录（merge-multiple=false），
 * 让 workflow 任选其一都不会破坏渲染。
 */
async function findMetadataFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return []
    throw error
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isFile()) {
      if (entry.name.startsWith("release-size-") && entry.name.endsWith(".json")) {
        results.push(entryPath)
      }
    } else if (entry.isDirectory()) {
      results.push(...(await findMetadataFiles(entryPath)))
    }
  }
  return results
}

function requireOption(values: CliValues, key: string, subcommand: string): string {
  if (!values[key] || typeof values[key] !== "string") {
    throw new Error(`${subcommand}: missing required --${key}`)
  }
  return values[key]
}

async function runCollect(values: CliValues): Promise<void> {
  const platform = requireOption(values, "platform", "collect")
  const arch = requireOption(values, "arch", "collect")
  const version = requireOption(values, "version", "collect")
  const releaseDir = requireOption(values, "release-dir", "collect")
  const out = requireOption(values, "out", "collect")

  let metadata: ReleaseSizeMetadata
  if (platform === "darwin") {
    metadata = await collectMacMetadata({ version, arch, releaseDir })
  } else if (platform === "win32") {
    metadata = await collectWinMetadata({ version, arch, releaseDir })
  } else {
    throw new Error(`collect: unsupported --platform "${platform}" (expected darwin | win32)`)
  }

  await writeFile(out, JSON.stringify(metadata, null, 2) + "\n", "utf8")
  console.log(`release-size: wrote ${out}`)
}

async function runRender(values: CliValues): Promise<void> {
  const metadataDir = requireOption(values, "metadata-dir", "render")
  const ossBase = requireOption(values, "oss-base", "render")
  const version = requireOption(values, "version", "render")

  const files = await findMetadataFiles(metadataDir)
  const metadata: ReleaseSizeMetadata[] = []
  for (const file of files) {
    const text = await readFile(file, "utf8")
    metadata.push(JSON.parse(text) as ReleaseSizeMetadata)
  }

  const table = renderDownloadsTable({ version, ossBase, metadata })
  process.stdout.write(table + "\n")
}

function parseCli(argv: string[]): { command: string | undefined; values: CliValues } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      platform: { type: "string" },
      arch: { type: "string" },
      version: { type: "string" },
      "release-dir": { type: "string" },
      out: { type: "string" },
      "metadata-dir": { type: "string" },
      "oss-base": { type: "string" },
    },
  })
  return { command: positionals[0], values: values as CliValues }
}

function usage(): string {
  return [
    "Usage:",
    "  release-size.ts collect --platform <darwin|win32> --arch <arch> --version <v> --release-dir <dir> --out <path>",
    "  release-size.ts render  --metadata-dir <dir> --oss-base <url> --version <v>",
  ].join("\n")
}

const isMain = (() => {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(process.argv[1]).href
})()

if (isMain) {
  try {
    const { command, values } = parseCli(process.argv.slice(2))
    if (command === "collect") {
      await runCollect(values)
    } else if (command === "render") {
      await runRender(values)
    } else {
      throw new Error(`Unknown subcommand "${command ?? ""}".\n${usage()}`)
    }
  } catch (error) {
    console.error(`release-size: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
