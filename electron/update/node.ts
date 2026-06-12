import { app } from "electron"
import updaterPkg from "electron-updater"
import { branding } from "../branding.ts"
import { staticBaseUrl } from "../domain.ts"

// electron-updater 用 Object.defineProperty 在 CJS exports 上挂 autoUpdater getter；
// 必须走静态 default import 读 updaterPkg.autoUpdater（命名导入在 ESM 下会是 undefined）。

/**
 * 配置自动更新源（static.<endpoint>/release/apps/lumo/<platform>/<arch>）。
 * 仅打包态生效；dev 跳过。autoDownload=false，由用户/后续 UI 触发下载安装。
 */
export function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    return
  }
  try {
    const autoUpdater = updaterPkg.autoUpdater
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `${staticBaseUrl}/${branding.updateFeedPath}/${process.platform}/${process.arch}`,
    })
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.warn("[lumo] checkForUpdates failed:", error)
    })
  } catch (error) {
    console.error("[lumo] auto-updater setup failed:", error)
  }
}
