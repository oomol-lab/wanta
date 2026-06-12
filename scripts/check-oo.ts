// predev 守卫：dev 启动前确认 oo 二进制已就绪（postinstall 已下载到 .oo-bin/）。
// 缺失则直接报错退出，避免应用起来后、连接器工具真正调用 oo 时才以隐晦方式失败。
//
// 仅用于 dev：打包产物由 prepare-binaries 内置 oo，运行时一定存在，故无需在 Electron 主进程做检查
// （主进程禁用同步 fs，会阻塞渲染）。本脚本是独立 Node CLI，用同步 fs 无副作用。
// 设了 LUMO_OO_BIN 覆盖时跳过检查（信任开发者指定的路径）。

import { existsSync } from "node:fs"
import { localOoBinPath } from "./oo-cli.ts"

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
