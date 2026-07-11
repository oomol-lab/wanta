import crypto from "node:crypto"

export interface ArtifactResourceLease {
  expiresAt: number
  mime: string
  modifiedAt: number
  path: string
  size: number
  token: string
}

const defaultLeaseTtlMs = 15 * 60 * 1_000
const defaultMaxLeases = 256

// 管理本地制成品的短期访问租约，避免向渲染进程暴露原始文件路径。
export class ArtifactResourceLeaseStore {
  private readonly leases = new Map<string, ArtifactResourceLease>()

  constructor(
    private readonly ttlMs = defaultLeaseTtlMs,
    private readonly maxLeases = defaultMaxLeases,
  ) {}

  // 创建短期资源租约；先清理过期项，超出容量时按插入顺序淘汰最旧租约。
  grant(input: Omit<ArtifactResourceLease, "expiresAt" | "token">, now = Date.now()): ArtifactResourceLease {
    this.removeExpired(now)
    const token = crypto.randomUUID()
    const lease = { ...input, expiresAt: now + this.ttlMs, token }
    this.leases.set(token, lease)
    while (this.leases.size > this.maxLeases) {
      const oldest = this.leases.keys().next().value
      if (!oldest) {
        break
      }
      this.leases.delete(oldest)
    }
    return lease
  }

  // 解析有效租约并续期；过期租约会立即删除，访问成功会刷新淘汰顺序。
  resolve(token: string, now = Date.now()): ArtifactResourceLease | null {
    const lease = this.leases.get(token)
    if (!lease) {
      return null
    }
    if (lease.expiresAt <= now) {
      this.leases.delete(token)
      return null
    }
    const refreshed = { ...lease, expiresAt: now + this.ttlMs }
    this.leases.delete(token)
    this.leases.set(token, refreshed)
    return refreshed
  }

  // 清空所有租约，供应用退出时统一释放资源访问能力。
  clear(): void {
    this.leases.clear()
  }

  private removeExpired(now: number): void {
    for (const [token, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(token)
      }
    }
  }
}
