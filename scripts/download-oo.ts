// postinstall：把当前平台的 oo 二进制下载到 .oo-bin/（gitignore），供 dev 与打包共用。
//
// 全程 best-effort：任何失败只告警、不阻断 pnpm install（对齐 download-electron.ts）。
// 设 OO_SKIP_BINARY_DOWNLOAD=1 可跳过（如离线 CI 后续步骤会自行 ensure）。
// 下载/落位/可执行位的全部逻辑见 scripts/oo-cli.ts。

import { downloadOoBinary, OO_CLI_VERSION } from "./oo-cli.ts"

await main()

async function main(): Promise<void> {
  try {
    if (process.env.OO_SKIP_BINARY_DOWNLOAD === "1") {
      console.log("OO_SKIP_BINARY_DOWNLOAD=1, skip downloading oo binary.")
      return
    }
    const dest = await downloadOoBinary()
    console.log(`[wanta] oo ${OO_CLI_VERSION} ready at ${dest}`)
  } catch (error) {
    console.warn("[wanta] download-oo postinstall failed (non-fatal):", error)
  }
}
