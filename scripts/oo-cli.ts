// oo-cli 平台二进制的下载与定位（单一来源）。
//
// 本项目只用 oo 的二进制，不再把 @oomol-lab/oo-cli 列为 npm 依赖：
//   - postinstall（scripts/download-oo.ts）把【当前平台】的 oo 下载到 .oo-bin/（gitignore）；
//   - dev（electron/main.ts → resolveDevOoBin）与打包前置（scripts/prepare-binaries.ts）共用这一份；
//   - 上游发布的平台包 tarball 内 bin/oo 是 0644（缺少可执行位，1.2.0 起、1.3.0/1.4.2 复核仍是），故提取后必须 chmod 0o755，
//     否则直接 spawn 会 EACCES——这正是改造前 dev 直连 node_modules 报错的根因。
//
// 平台映射取自 @oomol-lab/oo-cli 的 platform-targets.json（1.2.0；1.3.0/1.4.2 复核平台集未变），含 Linux glibc/musl 判别。

import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")

// oo-cli 版本：原先经 package-lock 间接锁定，移除依赖后由此处单一锁定。升级 oo 改这里。
export const OO_CLI_VERSION = "1.4.2"

// 下载落地目录（gitignore）。dev 侧的同名路径解析见 electron/agent/binaries.ts resolveDevOoBin。
const localOoBinDir = path.join(repoRoot, ".oo-bin")

interface PlatformTarget {
  packageName: string
  executableFileName: string
}

interface ReportHeader {
  glibcVersionRuntime?: string
}

interface ProcessReport {
  header?: ReportHeader
}

/**
 * Linux libc 判别：与上游 platform-runtime.cjs 一致（有 glibc 运行时版本即 glibc，否则 musl）。
 * report 可注入以便单测；缺省读 process.report.getReport()。
 */
export function detectLinuxLibc(report?: ProcessReport): "glibc" | "musl" {
  const resolved =
    report ??
    (typeof process.report?.getReport === "function" ? (process.report.getReport() as ProcessReport) : undefined)
  const header = resolved?.header
  if (header && typeof header.glibcVersionRuntime === "string" && header.glibcVersionRuntime !== "") {
    return "glibc"
  }
  return "musl"
}

/** oo 可执行文件名（Windows 带 .exe）。 */
export function ooExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "oo.exe" : "oo"
}

/** 本地下载的 oo 二进制绝对路径（.oo-bin/<exe>）。dev 守卫与脚本侧用；electron 运行时见 binaries.ts resolveDevOoBin。 */
export function localOoBinPath(platform: NodeJS.Platform = process.platform): string {
  return path.join(localOoBinDir, ooExecutableName(platform))
}

/**
 * 平台/架构（Linux 含 libc）→ oo-cli 平台包名 + 可执行文件名。映射取自上游 platform-targets.json。
 * libc 可显式传入以便单测；缺省在 linux 上经 detectLinuxLibc() 探测。
 */
export function resolvePlatformTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  libc: "glibc" | "musl" = platform === "linux" ? detectLinuxLibc() : "glibc",
): PlatformTarget {
  const executableFileName = ooExecutableName(platform)
  if (platform === "darwin") {
    if (arch === "arm64") return { packageName: "@oomol-lab/oo-cli-darwin-arm64", executableFileName }
    if (arch === "x64") return { packageName: "@oomol-lab/oo-cli-darwin-x64", executableFileName }
  } else if (platform === "win32") {
    if (arch === "arm64") return { packageName: "@oomol-lab/oo-cli-win32-arm64", executableFileName }
    if (arch === "x64") return { packageName: "@oomol-lab/oo-cli-win32-x64", executableFileName }
  } else if (platform === "linux") {
    if (arch === "arm64") {
      return {
        packageName: libc === "musl" ? "@oomol-lab/oo-cli-linux-arm64-musl" : "@oomol-lab/oo-cli-linux-arm64-gnu",
        executableFileName,
      }
    }
    if (arch === "x64") {
      return {
        packageName: libc === "musl" ? "@oomol-lab/oo-cli-linux-x64-musl" : "@oomol-lab/oo-cli-linux-x64-gnu",
        executableFileName,
      }
    }
  }
  throw new Error(`No prebuilt oo binary is available for ${platform} ${arch}.`)
}

/** 读取 tar header 中的定长字段（NUL 终止的 ASCII 子串）。 */
function readTarString(header: Buffer, start: number, len: number): string {
  const slice = header.subarray(start, start + len)
  const nul = slice.indexOf(0)
  return slice.toString("utf-8", 0, nul === -1 ? len : nul)
}

/**
 * 从解压后的 tar 字节里取出单个文件（npm tarball 为标准 ustar，路径短、无 GNU long-name）。
 * 逐 512 字节 header 遍历：按 size 跳过每条记录的数据块，命中目标普通文件即返回其内容；
 * pax/global 扩展头（typeflag x/g）因名字不匹配被自然跳过。未找到返回 null；声明 size 越出
 * 缓冲区（截断/损坏 tarball）则抛错而非静默返回半截内容。
 */
export function extractFileFromTar(tar: Buffer, wantedPath: string): Buffer | null {
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    // 连续全零块标志归档结束。
    if (header.every((byte) => byte === 0)) {
      break
    }
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155) // ustar prefix（长路径才用到）
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(readTarString(header, 124, 12).trim() || "0", 8)
    const typeflag = String.fromCharCode(header[156] ?? 0)
    const dataStart = offset + 512
    if ((typeflag === "0" || typeflag === "\0") && fullName === wantedPath) {
      if (dataStart + size > tar.length) {
        throw new Error(`truncated tar: ${wantedPath} declares ${size} bytes but archive ends early`)
      }
      return tar.subarray(dataStart, dataStart + size)
    }
    // 数据块按 512 向上取整对齐。
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return null
}

/** 版本标记内容：平台包名 + 版本，二者任一变化即触发重新下载。 */
function versionTag(packageName: string): string {
  return `${packageName}@${OO_CLI_VERSION}`
}

async function isUpToDate(destPath: string, versionMarker: string, packageName: string): Promise<boolean> {
  try {
    await stat(destPath)
    const marker = (await readFile(versionMarker, "utf-8")).trim()
    return marker === versionTag(packageName)
  } catch {
    return false
  }
}

interface TarballMeta {
  tarball: string
  integrity: string
}

/** 查 registry packument，取指定版本的 tarball URL 与 integrity（SRI），用于下载与完整性校验。 */
async function resolveTarballMeta(packageName: string): Promise<TarballMeta> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`)
  if (!response.ok) {
    throw new Error(`fetch packument failed: HTTP ${response.status} ${packageName}`)
  }
  const packument = (await response.json()) as {
    versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }>
  }
  const dist = packument.versions?.[OO_CLI_VERSION]?.dist
  if (!dist?.tarball || !dist?.integrity) {
    throw new Error(`no dist info for ${packageName}@${OO_CLI_VERSION}`)
  }
  return { tarball: dist.tarball, integrity: dist.integrity }
}

/**
 * 用 registry 提供的 SRI（integrity）校验下载到的 tarball——等价于 npm install 对 dist.integrity 的校验，
 * 拦截 CDN 截断/缓存损坏/中途篡改。SRI 形如 "sha512-<base64>"（可能空格分隔多算法，取 sha512）。
 */
export function verifyTarballIntegrity(tgz: Buffer, integrity: string, source: string): void {
  const sri = integrity.split(/\s+/).find((entry) => entry.startsWith("sha512-"))
  if (!sri) {
    throw new Error(`unsupported integrity for ${source}: ${integrity}`)
  }
  const expected = sri.slice("sha512-".length)
  const actual = createHash("sha512").update(tgz).digest("base64")
  if (actual !== expected) {
    throw new Error(`integrity mismatch for ${source}: expected ${expected}, got ${actual}`)
  }
}

/**
 * 确保【当前平台】的 oo 二进制存在于 .oo-bin/，返回其绝对路径（仅宿主平台：.oo-bin 单平台单份，
 * 不做跨平台暂存）。已存在且版本匹配则短路。流程：查 packument → 下载平台包 tarball → 按 registry
 * integrity 校验 → Node 内置 zlib 解压 → 自带 ustar 提取器取出 package/bin/<exe> → 写临时文件 →
 * chmod 0o755 →原子 rename 落位。全程不依赖任何外部命令或 npm 包，macOS/Linux/Windows 一致可用。
 */
export async function downloadOoBinary(): Promise<string> {
  const target = resolvePlatformTarget()
  const exe = target.executableFileName
  const destPath = localOoBinPath()
  const versionMarker = path.join(localOoBinDir, ".version")

  if (await isUpToDate(destPath, versionMarker, target.packageName)) {
    return destPath
  }

  const meta = await resolveTarballMeta(target.packageName)
  const response = await fetch(meta.tarball)
  if (!response.ok) {
    throw new Error(`download oo failed: HTTP ${response.status} ${meta.tarball}`)
  }
  const tgz = Buffer.from(await response.arrayBuffer())
  verifyTarballIntegrity(tgz, meta.integrity, meta.tarball)

  // tarball 内路径固定为 package/bin/<exe>。
  const binary = extractFileFromTar(gunzipSync(tgz), `package/bin/${exe}`)
  if (!binary) {
    throw new Error(`oo binary not found inside tarball: ${meta.tarball}`)
  }

  await mkdir(localOoBinDir, { recursive: true })
  // 先写临时文件、补可执行位（上游 tarball 内是 0644），再原子 rename，避免中断留下半截可执行文件。
  const tmpPath = `${destPath}.download`
  try {
    await writeFile(tmpPath, binary)
    await chmod(tmpPath, 0o755)
    await rename(tmpPath, destPath)
  } finally {
    // rename 成功后 tmp 已不存在；否则清掉半截文件。force 忽略 ENOENT。
    await rm(tmpPath, { force: true })
  }

  await writeFile(versionMarker, `${versionTag(target.packageName)}\n`, "utf-8")
  return destPath
}
