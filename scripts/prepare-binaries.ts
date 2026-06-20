// 打包前：把当前平台的 opencode + oo + rg 二进制复制到 resources/bin/，供 electron-builder
// extraResources 打进 app 的 Resources/bin（运行时 app.isPackaged 走 process.resourcesPath/bin）。
// 来源：
//   - opencode：node_modules/opencode-ai/bin/opencode.exe（opencode-ai postinstall 已为本机选好
//     正确平台/变体并复制到这个固定名，故不自行拼包名，详见 electron/agent/binaries.ts）；
//   - oo：.oo-bin/（download-oo.ts 下载；缺失则此处自行 ensure，故全新检出 / 跳过 postinstall 的 CI 也能打包）。
//   - rg：.oo-bin/（download-ripgrep.ts 下载；OpenCode 内置 grep 工具运行时从 PATH 查找）。
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { downloadOoBinary, ooExecutableName } from "./oo-cli.ts"
import { downloadRipgrepBinary, ripgrepExecutableName } from "./ripgrep.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const platform = process.platform
const exe = platform === "win32" ? ".exe" : ""

const binDir = path.join(repoRoot, "resources", "bin")
mkdirSync(binDir, { recursive: true })

function bundle(label: string, src: string, dstName: string): void {
  const dst = path.join(binDir, dstName)
  copyFileSync(src, dst)
  chmodSync(dst, 0o755)
  console.log(`[lumo] bundled ${label}: ${dstName}`)
}

bundle(
  "opencode",
  // opencode-ai 的 bin 名在所有平台都固定为 opencode.exe（内容即本机二进制）。
  path.join(repoRoot, "node_modules", "opencode-ai", "bin", "opencode.exe"),
  `opencode${exe}`,
)

// oo 不再依赖 node_modules：确保 .oo-bin/ 已就绪（缺失则下载当前平台的二进制）后复制。
const ooSrc = await downloadOoBinary()
bundle("oo", ooSrc, ooExecutableName())

// rg 与 oo 放在同一 bin 目录；AgentManager 会把该目录前置注入 PATH，供 OpenCode grep 工具使用。
const ripgrepSrc = await downloadRipgrepBinary()
bundle("ripgrep", ripgrepSrc, ripgrepExecutableName())
