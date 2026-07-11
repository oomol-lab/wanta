import type { LocalArtifactPreviewResult } from "./common.ts"

export interface SpreadsheetPreviewWorkerRequest {
  id: string
  mime: string
  path: string
  size: number
}

export type SpreadsheetPreviewWorkerResponse =
  | { id: string; result: LocalArtifactPreviewResult }
  | { error: string; id: string }
