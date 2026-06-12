import path from "node:path"

function opencodeExecutableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "opencode.exe" : "opencode"
}

/**
 * dev：解析 opencode 二进制。opencode-ai 的 postinstall 已把【当前平台】（含 AVX2/baseline 变体的正确选择）
 * 的二进制复制到 node_modules/opencode-ai/bin/opencode.exe——该文件名在所有平台上固定为 `opencode.exe`，
 * 内容即本机可执行二进制。直接用它，避免自行拼平台包名（如 opencode-${platform}-${arch}：Windows 的
 * process.platform 是 'win32' 但上游包名是 'windows'，且无法覆盖 *-baseline 回退变体）。生产由 extraResources 解析。
 */
export function resolveDevOpencodeBin(repoRoot: string): string {
  return path.join(repoRoot, "node_modules", "opencode-ai", "bin", "opencode.exe")
}

export function opencodeBinaryName(platform: NodeJS.Platform = process.platform): string {
  return opencodeExecutableName(platform)
}

export function ooBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "oo.exe" : "oo"
}

/** dev：从项目本地 .oo-bin 解析 oo 二进制（postinstall 下载、prepare-binaries 同源；生产由 extraResources 解析）。 */
export function resolveDevOoBin(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(repoRoot, ".oo-bin", ooBinaryName(platform))
}

/** 生产：从打包的 Resources/bin 解析二进制（prepare-binaries 复制、extraResources 打入）。 */
export function resolveBundledBin(resourcesPath: string, binaryName: string): string {
  return path.join(resourcesPath, "bin", binaryName)
}
