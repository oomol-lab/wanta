// predev 守卫：dev 启动前确认 oo / rg 二进制已就绪（postinstall 已下载到 .oo-bin/）。
// 缺失则直接报错退出，避免应用起来后、工具真正调用时才以隐晦方式失败。
//
// 仅用于 dev：打包产物由 prepare-binaries 内置二进制，运行时一定存在，故无需在 Electron 主进程做检查
// （主进程禁用同步 fs，会阻塞渲染）。本脚本是独立 Node CLI，用同步 fs 无副作用。
// 设了 LUMO_OO_BIN 覆盖时跳过检查（信任开发者指定的路径）。

import { existsSync } from "node:fs"
import { localOoBinPath } from "./oo-cli.ts"
import { localRipgrepBinPath } from "./ripgrep.ts"
import { bundledSkillsDir, exportBundledSkills } from "./skills.ts"

if (!process.env.LUMO_OO_BIN) {
  const ooBin = localOoBinPath()
  if (!existsSync(ooBin)) {
    console.error(
      `[lumo] oo 二进制缺失：${ooBin}\n` +
        "  运行 `npm run postinstall` 重新下载，或设 LUMO_OO_BIN 指向已有 oo（见 .env.example）。",
    )
    process.exit(1)
  }
}

const rgBin = localRipgrepBinPath()
if (!existsSync(rgBin)) {
  console.error(
    `[lumo] ripgrep 二进制缺失：${rgBin}\n` + "  运行 `npm run postinstall` 重新下载；本地文件搜索工具需要 rg。",
  )
  process.exit(1)
}

// 内置 oo skill 缺失（如跳过 postinstall）时自动导出，使 dev 下 agent 也能读到这 4 个 skill。
// 非致命：导出失败仅告警，运行时 workspace 同步会优雅跳过。
if (!existsSync(bundledSkillsDir)) {
  try {
    await exportBundledSkills()
    console.log(`[lumo] bundled skills ready at ${bundledSkillsDir}`)
  } catch (error) {
    console.warn("[lumo] failed to export bundled skills (non-fatal):", error)
  }
}
