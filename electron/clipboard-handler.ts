import { clipboard, ipcMain } from "electron"
import { WRITE_CLIPBOARD_TEXT_CHANNEL } from "./clipboard-common.ts"

export function registerClipboardHandler(): void {
  ipcMain.handle(WRITE_CLIPBOARD_TEXT_CHANNEL, (_event, text: unknown): void => {
    if (typeof text !== "string") {
      throw new Error("Clipboard text must be a string.")
    }
    clipboard.writeText(text)
  })
}
