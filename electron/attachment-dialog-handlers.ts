import type { AttachmentPickerKind, SaveClipboardAttachmentInput, SelectedAttachmentPath } from "./attachment-picker.ts"
import type { CreateSpreadsheetPreview } from "./chat/spreadsheet-agent-input.ts"

import { app, BrowserWindow, dialog, ipcMain } from "electron"
import { stat } from "node:fs/promises"
import path from "node:path"
import { isAttachmentPickerKind } from "./attachment-picker.ts"
import { mimeFromFile } from "./chat/artifacts.ts"
import { saveClipboardAttachment } from "./chat/clipboard-attachment.ts"
import { createSpreadsheetAgentInput } from "./chat/spreadsheet-agent-input.ts"

interface AttachmentDialogHandlerOptions {
  createSpreadsheetPreview?: CreateSpreadsheetPreview
  userDataDir?: string
}

export async function prepareSelectedAttachment(
  userDataDir: string,
  item: SelectedAttachmentPath | null,
  createSpreadsheetPreview: CreateSpreadsheetPreview | undefined,
  remember: (filePath: string) => void,
  reportFailure: (error: unknown) => void,
): Promise<SelectedAttachmentPath | null> {
  if (!item || item.kind !== "file" || !createSpreadsheetPreview) return item
  try {
    const agentInput = await createSpreadsheetAgentInput(userDataDir, item, createSpreadsheetPreview)
    if (!agentInput) return item
    remember(agentInput.agentPath)
    return { ...item, ...agentInput }
  } catch (error) {
    reportFailure(error)
    return item
  }
}

export function registerAttachmentDialogHandlers(
  trustedPaths: Set<string>,
  options: AttachmentDialogHandlerOptions = {},
): void {
  const userDataDir = options.userDataDir ?? app.getPath("userData")
  const remember = (filePath: string): void => {
    if (filePath.trim()) trustedPaths.add(filePath)
  }

  const prepare = (item: SelectedAttachmentPath | null): Promise<SelectedAttachmentPath | null> =>
    prepareSelectedAttachment(userDataDir, item, options.createSpreadsheetPreview, remember, (error) => {
      console.warn("[wanta] failed to prepare spreadsheet attachment:", error)
    })

  ipcMain.handle("wanta:select-attachment-paths", async (event, kind: unknown): Promise<SelectedAttachmentPath[]> => {
    assertAttachmentPickerKind(kind)
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const properties = attachmentDialogProperties(kind, process.platform)
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties })
      : await dialog.showOpenDialog({ properties })
    if (result.canceled) return []
    const items: SelectedAttachmentPath[] = []
    for (const filePath of result.filePaths) {
      const item = await prepare(await selectedAttachmentPath(filePath))
      if (item) items.push(item)
    }
    for (const item of items) remember(item.path)
    return items
  })

  ipcMain.handle(
    "wanta:save-clipboard-attachment",
    async (_event, req: SaveClipboardAttachmentInput): Promise<SelectedAttachmentPath> => {
      const attachment = await saveClipboardAttachment(userDataDir, req)
      remember(attachment.path)
      return (await prepare({ ...attachment, kind: "file" })) ?? { ...attachment, kind: "file" }
    },
  )

  ipcMain.handle("wanta:selected-attachment-path-for-file", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || !filePath.trim()) return null
    const item = await prepare(await selectedAttachmentPath(filePath))
    if (item) remember(item.path)
    return item
  })

  ipcMain.handle("wanta:select-project-directory", async (event): Promise<SelectedAttachmentPath | null> => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const directoryPath = result.filePaths[0]
    return {
      name: path.basename(directoryPath.replace(/[\\/]+$/, "")) || directoryPath,
      mime: "inode/directory",
      size: 0,
      path: directoryPath,
      kind: "directory",
    }
  })
}

function assertAttachmentPickerKind(kind: unknown): asserts kind is AttachmentPickerKind {
  if (!isAttachmentPickerKind(kind)) throw new Error("Invalid attachment picker kind.")
}

function attachmentDialogProperties(
  kind: AttachmentPickerKind,
  platform: NodeJS.Platform,
): NonNullable<Electron.OpenDialogOptions["properties"]> {
  switch (kind) {
    case "file":
      return ["openFile", "multiSelections"]
    case "directory":
      return ["openDirectory", "multiSelections"]
    case "file-or-directory":
      if (platform !== "darwin") throw new Error("Selecting files and folders together is only supported on macOS.")
      return ["openFile", "openDirectory", "multiSelections"]
  }
}

async function selectedAttachmentPath(filePath: string): Promise<SelectedAttachmentPath | null> {
  try {
    const info = await stat(filePath)
    const kind = info.isDirectory() ? "directory" : "file"
    return {
      name: path.basename(filePath.replace(/[\\/]+$/, "")) || filePath,
      mime: kind === "directory" ? "inode/directory" : await mimeFromFile(filePath, info.size),
      size: kind === "file" ? info.size : 0,
      path: filePath,
      kind,
    }
  } catch {
    return null
  }
}
