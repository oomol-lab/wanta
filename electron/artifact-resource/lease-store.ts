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

export class ArtifactResourceLeaseStore {
  private readonly leases = new Map<string, ArtifactResourceLease>()

  constructor(
    private readonly ttlMs = defaultLeaseTtlMs,
    private readonly maxLeases = defaultMaxLeases,
  ) {}

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
