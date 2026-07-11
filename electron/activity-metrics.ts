export interface ActivityMetricSnapshot {
  counts: Record<string, number>
  durationMs: number
  total: number
}

const defaultFlushIntervalMs = 10_000
const defaultMaxKeys = 64
const overflowMetricKey = "other"

/** 低成本聚合高频活动；固定窗口最多写一条 diagnostics，且限制动态 key 数量。 */
export class ActivityMetrics {
  private readonly counts = new Map<string, number>()
  private readonly flushIntervalMs: number
  private readonly maxKeys: number
  private readonly now: () => number
  private readonly onFlush: (snapshot: ActivityMetricSnapshot) => void
  private startedAt: number | undefined
  private timer: NodeJS.Timeout | undefined
  private total = 0

  public constructor(
    onFlush: (snapshot: ActivityMetricSnapshot) => void,
    options: { flushIntervalMs?: number; maxKeys?: number; now?: () => number } = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? defaultFlushIntervalMs
    this.maxKeys = options.maxKeys ?? defaultMaxKeys
    this.now = options.now ?? Date.now
    this.onFlush = onFlush
  }

  public record(key: string, count = 1): void {
    if (!Number.isFinite(count) || count <= 0) {
      return
    }
    const normalizedKey = this.counts.has(key) || this.counts.size < this.maxKeys ? key : overflowMetricKey
    this.counts.set(normalizedKey, (this.counts.get(normalizedKey) ?? 0) + count)
    this.total += count
    this.startedAt ??= this.now()
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.flushIntervalMs)
    this.timer.unref?.()
  }

  public flush(): ActivityMetricSnapshot | null {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.total === 0 || this.startedAt === undefined) {
      return null
    }
    const snapshot = {
      counts: Object.fromEntries([...this.counts].sort(([left], [right]) => left.localeCompare(right))),
      durationMs: Math.max(0, this.now() - this.startedAt),
      total: this.total,
    }
    this.counts.clear()
    this.startedAt = undefined
    this.total = 0
    this.onFlush(snapshot)
    return snapshot
  }

  public dispose(): void {
    this.flush()
  }
}
