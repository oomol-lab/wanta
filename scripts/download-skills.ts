// postinstall：把 oo 自带 skill 导出到 resources/skills/（gitignore），供 dev 运行时与打包共用。
//
// 全程 best-effort：任何失败只告警、不阻断 npm install（对齐 download-oo.ts）。
// 设 OO_SKIP_BINARY_DOWNLOAD=1 可跳过（与 oo 二进制下载共用同一开关；预演/打包会自行 ensure）。
// 导出/校验逻辑见 scripts/skills.ts。

import { exportBundledSkills } from "./skills.ts"

await main()

async function main(): Promise<void> {
  try {
    if (process.env.OO_SKIP_BINARY_DOWNLOAD === "1") {
      console.log("OO_SKIP_BINARY_DOWNLOAD=1, skip exporting bundled skills.")
      return
    }
    const dest = await exportBundledSkills()
    console.log(`[lumo] bundled skills ready at ${dest}`)
  } catch (error) {
    console.warn("[lumo] download-skills postinstall failed (non-fatal):", error)
  }
}
