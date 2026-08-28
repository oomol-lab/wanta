// 打包前：把当前平台的 opencode + oo + rg + 三个 Direct CLI 二进制复制到 resources/bin/，供 electron-builder
// extraResources 打进 app 的 Resources/bin（运行时 app.isPackaged 走 process.resourcesPath/bin）。
// 来源：
//   - opencode：node_modules/opencode-ai/bin/opencode.exe（opencode-ai postinstall 已为本机选好
//     正确平台/变体并复制到这个固定名，故不自行拼包名，详见 electron/agent/binaries.ts）；
//   - oo：.oo-bin/（download-oo.ts 下载；缺失则此处自行 ensure，故全新检出 / 跳过 postinstall 的 CI 也能打包）。
//   - rg：.oo-bin/（download-ripgrep.ts 下载；OpenCode 内置 grep 工具运行时从 PATH 查找）。
//   - Direct CLI：各自的项目本地 bin 目录；同时导出与固定版本匹配的官方 Skills。
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EXTERNAL_OO_CONTRACT_VERSION } from "../electron/agent/external/oo-capability-contract.ts"
import { buildAgentToolRuntime } from "./build-agent-tool-runtime.ts"
import { bundleClaudeAgentAcp } from "./claude-agent-acp.ts"
import { bundleCodexAcp } from "./codex-acp.ts"
import { dingTalkCliBinaryName, downloadDingTalkCliBinary, exportDingTalkCliSkills } from "./dingtalk-cli.ts"
import { downloadLarkCliBinary, exportLarkCliSkills, larkCliBinaryName } from "./lark-cli.ts"
import { downloadOoBinary, ooExecutableName, OO_CLI_VERSION } from "./oo-cli.ts"
import { downloadRipgrepBinary, ripgrepExecutableName } from "./ripgrep.ts"
import {
  bundledOoSkillHashes,
  bundledSkillsDir,
  exportBundledSkills,
  verifyBundledOoSkillCompatibility,
} from "./skills.ts"
import { downloadWecomCliBinary, exportWecomCliSkills, wecomCliBinaryName } from "./wecom-cli.ts"

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
  console.log(`[wanta] bundled ${label}: ${dstName}`)
}

bundle(
  "opencode",
  // opencode-ai 的 bin 名在所有平台都固定为 opencode.exe（内容即本机二进制）。
  path.join(repoRoot, "node_modules", "opencode-ai", "bin", "opencode.exe"),
  `opencode${exe}`,
)

// Codex 通过 ACP bridge 接入。开发态从 node_modules/.bin 解析；打包态必须把同版本的
// 自包含 JS bundle 和启动 shim 放进 Resources/bin，不能依赖构建机的 pnpm shim。
const bundledCodexAcp = bundleCodexAcp(binDir, platform)
console.log(`[wanta] bundled codex-acp: ${path.basename(bundledCodexAcp.entryPath)}@${bundledCodexAcp.version}`)

const bundledClaudeAgentAcp = await bundleClaudeAgentAcp(binDir, platform)
console.log(
  `[wanta] bundled claude-agent-acp: ${path.basename(bundledClaudeAgentAcp.entryPath)}@${bundledClaudeAgentAcp.version}`,
)

// oo 不再依赖 node_modules：确保 .oo-bin/ 已就绪（缺失则下载当前平台的二进制）后复制。
const ooSrc = await downloadOoBinary()
bundle("oo", ooSrc, ooExecutableName())

// rg 与 oo 放在同一 bin 目录；AgentManager 会把该目录前置注入 PATH，供 OpenCode grep 工具使用。
const ripgrepSrc = await downloadRipgrepBinary()
bundle("ripgrep", ripgrepSrc, ripgrepExecutableName())

const larkCliSrc = await downloadLarkCliBinary()
bundle("Lark CLI", larkCliSrc, larkCliBinaryName())
await exportLarkCliSkills()
console.log("[wanta] bundled Lark CLI skills")

const wecomCliSrc = await downloadWecomCliBinary()
bundle("WeCom CLI", wecomCliSrc, wecomCliBinaryName())
await exportWecomCliSkills()
console.log("[wanta] bundled WeCom CLI skills")

const dingTalkCliSrc = await downloadDingTalkCliBinary()
bundle("DingTalk CLI", dingTalkCliSrc, dingTalkCliBinaryName())
await exportDingTalkCliSkills()
console.log("[wanta] bundled DingTalk CLI skills")

// 内置 4 个 oo skill：导出到 resources/skills/，由 electron-builder extraResources 打入 Resources/skills，
// 运行时拷进 OpenCode workspace 的 .opencode/skill/（见 electron/agent/workspace.ts）。
await exportBundledSkills()
await verifyBundledOoSkillCompatibility()
await writeFile(
  path.join(binDir, "oo-runtime-compatibility.json"),
  `${JSON.stringify(
    {
      contractVersion: EXTERNAL_OO_CONTRACT_VERSION,
      files: await bundledOoSkillHashes(),
      ooCliVersion: OO_CLI_VERSION,
    },
    null,
    2,
  )}\n`,
  "utf8",
)
console.log(`[wanta] bundled skills: ${path.basename(bundledSkillsDir)}`)

// 自定义工具的 tool helper + Zod 合并为单文件，随包发布，工具加载不依赖首次启动隐式联网安装 npm 包。
await buildAgentToolRuntime()
