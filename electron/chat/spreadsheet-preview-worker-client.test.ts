import assert from "node:assert/strict"
import { test } from "vitest"
import { spreadsheetPreviewWorkerUrl } from "./spreadsheet-preview-worker-client.ts"

test("spreadsheetPreviewWorkerUrl resolves beside the bundled main entry", () => {
  assert.equal(
    spreadsheetPreviewWorkerUrl("file:///Applications/Wanta.app/Contents/Resources/app.asar/dist-electron/main.js")
      .href,
    "file:///Applications/Wanta.app/Contents/Resources/app.asar/dist-electron/spreadsheet-preview-worker.js",
  )
})
