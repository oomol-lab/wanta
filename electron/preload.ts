import type { AppCommand } from "./app-command.ts"
import type { AppLocale } from "./app-locale.ts"
import type { AttachmentPickerKind } from "./attachment-picker.ts"

export type { AttachmentPickerKind } from "./attachment-picker.ts"

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

export interface RendererErrorReport {
  message: string
  source: "error" | "handled" | "unhandledrejection"
  scope?: string
  stack?: string
}

export interface WantaBridge {
  appCommit: string
  getPathForFile(file: File): string
  onAppCommand(callback: (command: AppCommand) => void): () => void
  platform: NodeJS.Platform
  reportRendererError(input: RendererErrorReport): void
  saveClipboardAttachment(input: SaveClipboardAttachmentInput): Promise<SelectedAttachmentPath>
  selectAttachmentPaths(kind: AttachmentPickerKind): Promise<SelectedAttachmentPath[]>
  selectProjectDirectory(): Promise<SelectedAttachmentPath | null>
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
  reportRendererError: (input: RendererErrorReport) => ipcRenderer.send("wanta:renderer-error", input),
  saveClipboardAttachment: (input: SaveClipboardAttachmentInput) =>
    electronAPI.ipcRenderer.invoke("wanta:save-clipboard-attachment", input) as Promise<SelectedAttachmentPath>,
  selectAttachmentPaths: (kind: AttachmentPickerKind) =>
    electronAPI.ipcRenderer.invoke("wanta:select-attachment-paths", kind) as Promise<SelectedAttachmentPath[]>,
  selectProjectDirectory: () =>
    electronAPI.ipcRenderer.invoke("wanta:select-project-directory") as Promise<SelectedAttachmentPath | null>,
  setAppLocale: (locale: AppLocale) => ipcRenderer.send(APP_LOCALE_CHANNEL, locale),
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld(branding.windowBridge, wanta)
  } catch (error) {
    console.error("[wanta] failed to expose preload bridge:", error)
    ipcRenderer.send("wanta:renderer-error", {
      message: "Failed to expose preload bridge",
      source: "handled",
      scope: "preload.exposeBridge",
      stack: error instanceof Error ? error.stack : undefined,
    } satisfies RendererErrorReport)
  }
} else {
  window.electron = electronAPI
  window.wanta = wanta
}
