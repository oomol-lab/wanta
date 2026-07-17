import type { AttachmentPickerKind, SaveClipboardAttachmentInput, SelectedAttachmentPath } from "./attachment-picker.ts"
import type { CreateSpreadsheetPreview } from "./chat/spreadsheet-agent-input.ts"

import { app, BrowserWindow, dialog, ipcMain } from "electron"
import { randomUUID } from "node:crypto"
import { chmod, copyFile, mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { isAttachmentPickerKind } from "./attachment-picker.ts"
import { mimeFromFile } from "./chat/artifacts.ts"
import { saveClipboardAttachment } from "./chat/clipboard-attachment.ts"
import { createSpreadsheetAgentInput } from "./chat/spreadsheet-agent-input.ts"

interface AttachmentDialogHandlerOptions {
  createSpreadsheetPreview?: CreateSpreadsheetPreview
  userDataDir?: string
}

function managedAttachmentName(name: string): string {
  return (
    path
      .basename(name)
      .replace(/[<>:"/\\|?*]/g, "_")
      .replaceAll(/./g, (character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .trim()
      .slice(0, 160) || "attachment"
  )
}

/** 文件附件先冻结到 Wanta 私有目录；后续预览、提取和 agent 工具均不得读写用户源文件。 */
export async function snapshotSelectedAttachment(
  userDataDir: string,
  item: SelectedAttachmentPath,
): Promise<SelectedAttachmentPath> {
  if (item.kind !== "file") return item
  const snapshotDirectory = path.join(userDataDir, "attachments", "originals", randomUUID())
  const finalPath = path.join(snapshotDirectory, managedAttachmentName(item.name))
  const temporaryPath = `${finalPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    const sourceBefore = await stat(item.path)
    if (!sourceBefore.isFile() || sourceBefore.size !== item.size) {
      throw new Error("Attachment changed before Wanta could create its immutable snapshot.")
    }
    await mkdir(snapshotDirectory, { recursive: true })
    await copyFile(item.path, temporaryPath)
    await chmod(temporaryPath, 0o600)
    const [copied, sourceAfter] = await Promise.all([stat(temporaryPath), stat(item.path)])
    if (
      !copied.isFile() ||
      copied.size !== item.size ||
      sourceAfter.size !== sourceBefore.size ||
      sourceAfter.mtimeMs !== sourceBefore.mtimeMs
    ) {
      throw new Error("Attachment changed while Wanta was creating its immutable snapshot.")
    }
    await rename(temporaryPath, finalPath)
    await chmod(finalPath, 0o400)
    await chmod(snapshotDirectory, 0o500)
    return { ...item, path: finalPath }
  } catch (error) {
    await rm(snapshotDirectory, { force: true, recursive: true })
    throw error
  }
}

export async function prepareSelectedAttachment(
  userDataDir: string,
  item: SelectedAttachmentPath | null,
  createSpreadsheetPreview: CreateSpreadsheetPreview | undefined,
  remember: (filePath: string) => void,
  reportFailure: (error: unknown) => void,
): Promise<SelectedAttachmentPath | null> {
  if (!item || item.kind !== "file") return item
  let snapshot: SelectedAttachmentPath
  try {
    snapshot = await snapshotSelectedAttachment(userDataDir, item)
  } catch (error) {
    reportFailure(error)
    throw error
  }
  if (!createSpreadsheetPreview) return snapshot
  try {
    const agentInput = await createSpreadsheetAgentInput(userDataDir, snapshot, createSpreadsheetPreview)
    if (!agentInput) return snapshot
    remember(agentInput.agentPath)
    return { ...snapshot, ...agentInput }
  } catch (error) {
    reportFailure(error)
    return snapshot
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
