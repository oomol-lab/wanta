import type { UpdateChannel } from "./channel.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type { UpdateChannel } from "./channel.ts"

export type AppUpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "not-available" }
  | { status: "available"; version: string; releaseDate?: string }
  | { status: "downloading"; percent?: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; error: string }

export interface AppUpdateState {
  /** 运行中应用自身的版本（app.getVersion()）。 */
  currentVersion: string
  /** dev（未打包）时为 false：更新不可用，UI 显示提示而非按钮。 */
  isPackaged: boolean
  channel: UpdateChannel
  /** 最近一次检查完成时间（ISO）；从未检查过则缺失。 */
  checkedAt?: string
  status: AppUpdateStatus
}

export type UpdateService = typeof UpdateService
export const UpdateService = serviceName("update-service") as ServiceName<{
  ServerEvents: {
    appUpdateStateChanged: AppUpdateState
  }
  ClientInvokes: {
    getAppUpdateState(): Promise<AppUpdateState>
    checkForAppUpdate(): Promise<AppUpdateState>
    /** 下载已发现的更新（autoDownload=false，下载始终由 UI 显式触发）。 */
    downloadAppUpdate(): Promise<void>
    /** 退出并安装已下载的更新。 */
    installDownloadedAppUpdate(): Promise<void>
    /** 切换更新渠道：持久化 + 重配 feed + 触发一次检查。 */
    setUpdateChannel(channel: UpdateChannel): Promise<AppUpdateState>
  }
}>
