import type { AppCommand } from "./app-command.ts"
import type { AppLocale } from "./app-locale.ts"

import { electronAPI } from "@electron-toolkit/preload"
import { setupConnectionPreload } from "@oomol/connection-electron-adapter/preload"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import { APP_COMMAND_CHANNEL, isAppCommand } from "./app-command.ts"
import { APP_LOCALE_CHANNEL } from "./app-locale.ts"
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

export interface SaveClipboardAttachmentInput {
  name?: string
  mime?: string
  bytes: ArrayBuffer
}

export interface WantaBridge {
  appCommit: string
  getPathForFile(file: File): string
  onAppCommand(callback: (command: AppCommand) => void): () => void
  platform: NodeJS.Platform
  saveClipboardAttachment(input: SaveClipboardAttachmentInput): Promise<SelectedAttachmentPath>
  selectAttachmentPaths(kind: "file" | "directory"): Promise<SelectedAttachmentPath[]>
  setAppLocale(locale: AppLocale): void
  version: string
}

declare global {
  var electron: typeof electronAPI
  // 全局 bridge 名与 branding.windowBridge 一致（值固定为 "wanta"）。
  var wanta: WantaBridge
}

// @oomol/connection 的 RPC 桥接，仅此一行即可让 renderer 的 ElectronClientAdapter 找到通道。
setupConnectionPreload()

const wanta: WantaBridge = {
  appCommit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown",
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onAppCommand: (callback: (command: AppCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown): void => {
      if (isAppCommand(command)) {
        callback(command)
      }
    }
    ipcRenderer.on(APP_COMMAND_CHANNEL, listener)
    return () => ipcRenderer.removeListener(APP_COMMAND_CHANNEL, listener)
  },
  platform: process.platform,
  saveClipboardAttachment: (input: SaveClipboardAttachmentInput) =>
    electronAPI.ipcRenderer.invoke("wanta:save-clipboard-attachment", input) as Promise<SelectedAttachmentPath>,
  selectAttachmentPaths: (kind: "file" | "directory") =>
    electronAPI.ipcRenderer.invoke("wanta:select-attachment-paths", kind) as Promise<SelectedAttachmentPath[]>,
  setAppLocale: (locale: AppLocale) => ipcRenderer.send(APP_LOCALE_CHANNEL, locale),
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld(branding.windowBridge, wanta)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.wanta = wanta
}
