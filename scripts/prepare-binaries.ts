// 打包前：把当前平台的 opencode + oo 二进制复制到 resources/bin/，供 electron-builder
// extraResources 打进 app 的 Resources/bin（运行时 app.isPackaged 走 process.resourcesPath/bin）。
// 来源：
//   - opencode：node_modules/opencode-ai/bin/opencode.exe（opencode-ai postinstall 已为本机选好
//     正确平台/变体并复制到这个固定名，故不自行拼包名，详见 electron/agent/binaries.ts）；
//   - oo：.oo-bin/（download-oo.ts 下载；缺失则此处自行 ensure，故全新检出 / 跳过 postinstall 的 CI 也能打包）。
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { downloadOoBinary, ooExecutableName } from "./oo-cli.ts"

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
