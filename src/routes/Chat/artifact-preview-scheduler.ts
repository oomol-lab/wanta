export type ArtifactPreviewLoadPriority = "background" | "interactive"

interface QueuedPreviewLoad {
  cleanup?: () => void
  load: () => Promise<unknown>
  reject: (reason?: unknown) => void
  resolve: (value: unknown) => void
}

export class ArtifactPreviewLoadCancelledError extends Error {
  public constructor() {
    super("Artifact preview load was cancelled")
    this.name = "ArtifactPreviewLoadCancelledError"
  }
}

export class ArtifactPreviewLoadScheduler {
  private activeCount = 0
  private readonly backgroundQueue: QueuedPreviewLoad[] = []
  private readonly interactiveQueue: QueuedPreviewLoad[] = []

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxBackgroundQueue = 96,
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("Artifact preview concurrency must be a positive integer")
    }
    if (!Number.isInteger(maxBackgroundQueue) || maxBackgroundQueue < 1) {
      throw new Error("Artifact preview background queue limit must be a positive integer")
    }
  }

  schedule<T>(load: () => Promise<T>, priority: ArtifactPreviewLoadPriority, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ArtifactPreviewLoadCancelledError())
        return
      }
      const task: QueuedPreviewLoad = {
        load,
        reject,
        resolve: (value) => resolve(value as T),
      }
      const queue = priority === "interactive" ? this.interactiveQueue : this.backgroundQueue
      if (priority === "background" && queue.length >= this.maxBackgroundQueue) {
        const dropped = queue.shift()
        dropped?.cleanup?.()
        dropped?.reject(new ArtifactPreviewLoadCancelledError())
      }
      queue.push(task)
      if (signal) {
        const cancel = (): void => {
          const index = queue.indexOf(task)
          if (index < 0) {
            return
          }
          queue.splice(index, 1)
          task.cleanup?.()
          reject(new ArtifactPreviewLoadCancelledError())
        }
        signal.addEventListener("abort", cancel, { once: true })
        task.cleanup = () => signal.removeEventListener("abort", cancel)
      }
      this.drain()
    })
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency) {
      const task = this.interactiveQueue.shift() ?? this.backgroundQueue.shift()
      if (!task) {
        return
      }
      task.cleanup?.()
      this.activeCount += 1
      void Promise.resolve()
        .then(task.load)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeCount -= 1
          this.drain()
        })
    }
  }
}

// Native thumbnail generation cannot be interrupted. Keep its real work in a separate
// pool so stale thumbnails cannot occupy the slots needed by the selected file.
const interactivePreviewLoadScheduler = new ArtifactPreviewLoadScheduler(2)
const backgroundPreviewLoadScheduler = new ArtifactPreviewLoadScheduler(4)

export function scheduleArtifactPreviewLoad<T>(
  load: () => Promise<T>,
  priority: ArtifactPreviewLoadPriority,
  signal?: AbortSignal,
): Promise<T> {
  const scheduler = priority === "interactive" ? interactivePreviewLoadScheduler : backgroundPreviewLoadScheduler
  return scheduler.schedule(load, priority, signal)
}
