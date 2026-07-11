import type {
  SpreadsheetPreviewWorkerRequest,
  SpreadsheetPreviewWorkerResponse,
} from "./spreadsheet-preview-worker-protocol.ts"

import { parentPort } from "node:worker_threads"
import { spreadsheetPreview } from "./artifact-preview.ts"

const workerPort = parentPort
if (!workerPort) {
  throw new Error("Spreadsheet preview worker requires a parent port")
}

workerPort.on("message", (request: SpreadsheetPreviewWorkerRequest) => {
  void spreadsheetPreview(request.path, request.mime, request.size).then(
    (result) => {
      workerPort.postMessage({ id: request.id, result } satisfies SpreadsheetPreviewWorkerResponse)
    },
    (error: unknown) => {
      workerPort.postMessage({
        error: error instanceof Error ? error.message : String(error),
        id: request.id,
      } satisfies SpreadsheetPreviewWorkerResponse)
    },
  )
})
