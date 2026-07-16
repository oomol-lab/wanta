import type { SelectedAttachmentPath } from "./attachment-picker.ts"

import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/wanta-user-data") },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import { prepareSelectedAttachment } from "./attachment-dialog-handlers.ts"

const workbook: SelectedAttachmentPath = {
  kind: "file",
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  name: "inventory.xlsx",
  path: "/tmp/inventory.xlsx",
  size: 100,
}

describe("prepareSelectedAttachment", () => {
  it("returns the original attachment when spreadsheet preview rejects", async () => {
    const error = new Error("preview failed")
    const reportFailure = vi.fn()

    const result = await prepareSelectedAttachment(
      "/tmp/wanta-user-data",
      workbook,
      async () => Promise.reject(error),
      vi.fn(),
      reportFailure,
    )

    expect(result).toBe(workbook)
    expect(reportFailure).toHaveBeenCalledWith(error)
  })
})
