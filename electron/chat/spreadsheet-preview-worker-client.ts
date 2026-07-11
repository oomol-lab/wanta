import type { LocalArtifactPreviewResult } from "./common.ts"
import type {
  SpreadsheetPreviewWorkerRequest,
  SpreadsheetPreviewWorkerResponse,
} from "./spreadsheet-preview-worker-protocol.ts"

import crypto from "node:crypto"
import { Worker } from "node:worker_threads"

interface QueuedSpreadsheetPreview {
  mime: string
  path: string
  reject: (error: Error) => void
  resolve: (result: LocalArtifactPreviewResult) => void
  size: number
}

const spreadsheetPreviewTimeoutMs = 15_000

export function spreadsheetPreviewWorkerUrl(moduleUrl = import.meta.url): URL {
  // 不使用 new Worker(new URL(...)) 的静态形式，避免 Vite 把独立 Electron 入口误写成渲染资源绝对路径。
  return new URL("./spreadsheet-preview-worker.js", moduleUrl)
}

export class SpreadsheetPreviewWorkerClient {
  private active: QueuedSpreadsheetPreview | null = null
  private activeId: string | null = null
  private disposed = false
  private queue: QueuedSpreadsheetPreview[] = []
  private timeout: NodeJS.Timeout | null = null
  private worker: Worker | null = null

  preview(path: string, mime: string, size: number): Promise<LocalArtifactPreviewResult> {
    if (this.disposed) {
      return Promise.reject(new Error("Spreadsheet preview worker is disposed"))
    }
    return new Promise((resolve, reject) => {
      if (this.active) {
        const superseded = new Error("Spreadsheet preview was superseded by a newer request")
        for (const task of this.queue.splice(0)) {
          task.reject(superseded)
        }
      }
      this.queue.push({ mime, path, reject, resolve, size })
      this.drain()
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const error = new Error("Spreadsheet preview worker is disposed")
    this.active?.reject(error)
    this.active = null
    this.activeId = null
    for (const task of this.queue.splice(0)) {
      task.reject(error)
    }
    this.clearTimeout()
    const worker = this.worker
    this.worker = null
    if (worker) {
      await worker.terminate()
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(spreadsheetPreviewWorkerUrl(), {
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    })
    worker.on("message", (response: SpreadsheetPreviewWorkerResponse) => this.handleResponse(response))
    worker.on("error", (error) => this.handleWorkerFailure(error))
    worker.on("exit", (code) => {
      if (!this.disposed && code !== 0 && this.worker === worker) {
        this.handleWorkerFailure(new Error(`Spreadsheet preview worker exited with code ${code}`))
      }
    })
    return worker
  }

  private drain(): void {
    if (this.disposed || this.active) {
      return
    }
    const task = this.queue.shift()
    if (!task) {
      return
    }
    this.worker ??= this.createWorker()
    const id = crypto.randomUUID()
    this.active = task
    this.activeId = id
    this.timeout = setTimeout(() => {
      this.handleWorkerFailure(new Error("Spreadsheet preview timed out"))
    }, spreadsheetPreviewTimeoutMs)
    this.worker.postMessage({
      id,
      mime: task.mime,
      path: task.path,
      size: task.size,
    } satisfies SpreadsheetPreviewWorkerRequest)
  }

  private handleResponse(response: SpreadsheetPreviewWorkerResponse): void {
    if (!this.active || response.id !== this.activeId) {
      return
    }
    const task = this.active
    this.active = null
    this.activeId = null
    this.clearTimeout()
    if ("error" in response) {
      task.reject(new Error(response.error))
    } else {
      task.resolve(response.result)
    }
    this.drain()
  }

  private handleWorkerFailure(error: Error): void {
    this.clearTimeout()
    this.worker?.removeAllListeners()
    void this.worker?.terminate()
    this.worker = null
    this.active?.reject(error)
    this.active = null
    this.activeId = null
    this.drain()
  }

  private clearTimeout(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }
}
