import type { AppCommand } from "./app-command.ts"
import type { AppLocale } from "./app-locale.ts"
import type { AttachmentPickerKind, SaveClipboardAttachmentInput, SelectedAttachmentPath } from "./attachment-picker.ts"

export type { AttachmentPickerKind, SaveClipboardAttachmentInput, SelectedAttachmentPath } from "./attachment-picker.ts"

import { setupConnectionPreload } from "@oomol/connection-electron-adapter/preload"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import { APP_COMMAND_CHANNEL, isAppCommand } from "./app-command.ts"
import { APP_LOCALE_CHANNEL } from "./app-locale.ts"
import { branding } from "./branding.ts"

declare const __APP_COMMIT__: string | undefined
declare const __APP_VERSION__: string | undefined

export interface RendererErrorReport {
  message: string
  source: "error" | "handled" | "unhandledrejection"
  scope?: string
  stack?: string
  suppressedCount?: number
}

export interface WantaBridge {
  appCommit: string
  onAppCommand(callback: (command: AppCommand) => void): () => void
  platform: NodeJS.Platform
  reportRendererError(input: RendererErrorReport): void
  saveClipboardAttachment(input: SaveClipboardAttachmentInput): Promise<SelectedAttachmentPath>
  selectedAttachmentPathForFile(file: File): Promise<SelectedAttachmentPath | null>
  selectAttachmentPaths(kind: AttachmentPickerKind): Promise<SelectedAttachmentPath[]>
  selectProjectDirectory(): Promise<SelectedAttachmentPath | null>
  setAppLocale(locale: AppLocale): void
  version: string
}

declare global {
  // 全局 bridge 名与 branding.windowBridge 一致（值固定为 "wanta"）。
  var wanta: WantaBridge
}

// @oomol/connection 的 RPC 桥接，仅此一行即可让 renderer 的 ElectronClientAdapter 找到通道。
setupConnectionPreload()

const wanta: WantaBridge = {
  appCommit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown",
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
    ipcRenderer.invoke("wanta:save-clipboard-attachment", input) as Promise<SelectedAttachmentPath>,
  selectedAttachmentPathForFile: (file: File) => {
    let filePath = ""
    try {
      filePath = webUtils.getPathForFile(file)
    } catch {
      return Promise.resolve(null)
    }
    return filePath
      ? (ipcRenderer.invoke(
          "wanta:selected-attachment-path-for-file",
          filePath,
        ) as Promise<SelectedAttachmentPath | null>)
      : Promise.resolve(null)
  },
  selectAttachmentPaths: (kind: AttachmentPickerKind) =>
    ipcRenderer.invoke("wanta:select-attachment-paths", kind) as Promise<SelectedAttachmentPath[]>,
  selectProjectDirectory: () =>
    ipcRenderer.invoke("wanta:select-project-directory") as Promise<SelectedAttachmentPath | null>,
  setAppLocale: (locale: AppLocale) => ipcRenderer.send(APP_LOCALE_CHANNEL, locale),
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
}

if (process.contextIsolated) {
  try {
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
  window.wanta = wanta
}
