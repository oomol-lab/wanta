export type ArtifactPreviewLoadPriority = "background" | "interactive"

interface QueuedPreviewLoad {
  load: () => Promise<unknown>
  reject: (reason?: unknown) => void
  resolve: (value: unknown) => void
}

export class ArtifactPreviewLoadScheduler {
  private activeCount = 0
  private readonly backgroundQueue: QueuedPreviewLoad[] = []
  private readonly interactiveQueue: QueuedPreviewLoad[] = []

  constructor(private readonly maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("Artifact preview concurrency must be a positive integer")
    }
  }

  schedule<T>(load: () => Promise<T>, priority: ArtifactPreviewLoadPriority): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueuedPreviewLoad = {
        load,
        reject,
        resolve: (value) => resolve(value as T),
      }
      const queue = priority === "interactive" ? this.interactiveQueue : this.backgroundQueue
      queue.push(task)
      this.drain()
    })
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency) {
      const task = this.interactiveQueue.shift() ?? this.backgroundQueue.shift()
      if (!task) {
        return
      }
      this.activeCount += 1
      void task
        .load()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeCount -= 1
          this.drain()
        })
    }
  }
}

const artifactPreviewLoadScheduler = new ArtifactPreviewLoadScheduler(6)

export function scheduleArtifactPreviewLoad<T>(
  load: () => Promise<T>,
  priority: ArtifactPreviewLoadPriority,
): Promise<T> {
  return artifactPreviewLoadScheduler.schedule(load, priority)
}
