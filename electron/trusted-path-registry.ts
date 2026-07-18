const defaultTrustedPathTtlMs = 60 * 60_000

/**
 * 文件选择器产生的短期本地路径授权。消息发送后应转成会话级授权并从这里移除；
 * 未发送的草稿路径也会自动过期，避免进程生命周期内永久扩大本地访问面。
 */
export class ExpiringTrustedPathRegistry implements Iterable<string> {
  private readonly expiresAtByPath = new Map<string, number>()
  private readonly now: () => number
  private readonly ttlMs: number
  private changeRevision = 0

  public constructor(ttlMs = defaultTrustedPathTtlMs, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }

  public add(filePath: string): void {
    const normalized = filePath.trim()
    if (!normalized) return
    this.pruneExpired()
    this.expiresAtByPath.set(normalized, this.now() + this.ttlMs)
    this.changeRevision += 1
  }

  public delete(filePath: string): boolean {
    const deleted = this.expiresAtByPath.delete(filePath.trim())
    if (deleted) this.changeRevision += 1
    return deleted
  }

  public clear(): void {
    if (this.expiresAtByPath.size > 0) this.changeRevision += 1
    this.expiresAtByPath.clear()
  }

  public get revision(): number {
    return this.changeRevision
  }

  public *[Symbol.iterator](): IterableIterator<string> {
    this.pruneExpired()
    yield* this.expiresAtByPath.keys()
  }

  private pruneExpired(): void {
    const now = this.now()
    let changed = false
    for (const [filePath, expiresAt] of this.expiresAtByPath) {
      if (expiresAt <= now) changed = this.expiresAtByPath.delete(filePath) || changed
    }
    if (changed) this.changeRevision += 1
  }
}
