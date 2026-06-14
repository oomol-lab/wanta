import { electronAPI } from "@electron-toolkit/preload"
import { setupConnectionPreload } from "@oomol/connection-electron-adapter/preload"
import { contextBridge, webUtils } from "electron"
import { branding } from "./branding.ts"

declare const __APP_COMMIT__: string | undefined
declare const __APP_VERSION__: string | undefined

export interface SelectedAttachmentPath {
  name: string
  mime: string
  size: number
  path: string
  kind: "file" | "directory"
}

export interface LumoBridge {
  appCommit: string
  getPathForFile(file: File): string
  platform: NodeJS.Platform
  selectAttachmentPaths(kind: "file" | "directory"): Promise<SelectedAttachmentPath[]>
  version: string
}

declare global {
  var electron: typeof electronAPI
  // 全局 bridge 名与 branding.windowBridge 一致（值固定为 "lumo"）。
  var lumo: LumoBridge
}

// @oomol/connection 的 RPC 桥接，仅此一行即可让 renderer 的 ElectronClientAdapter 找到通道。
setupConnectionPreload()

const lumo: LumoBridge = {
  appCommit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown",
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform,
  selectAttachmentPaths: (kind: "file" | "directory") =>
    electronAPI.ipcRenderer.invoke("lumo:select-attachment-paths", kind) as Promise<SelectedAttachmentPath[]>,
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld(branding.windowBridge, lumo)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.lumo = lumo
}
