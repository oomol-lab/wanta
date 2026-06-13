import type { SkillShareInfo, SkillShareInfoRequest } from "../../electron/skills/common.ts"

export interface SkillShareInfoEntry {
  error: string | null
  info: SkillShareInfo | null
  status: "idle" | "loading" | "ready"
  updatedAt: number | null
}

export type SkillShareInfoSnapshot = Record<string, SkillShareInfoEntry>

interface SkillShareInfoStoreOptions {
  load(request: SkillShareInfoRequest): Promise<SkillShareInfo>
  now?: () => number
  staleTimeMs?: number
}

type SkillShareInfoListener = () => void

const defaultStaleTimeMs = 5 * 60_000

function createUnpublishedShareInfo(packageName: string): SkillShareInfo {
  return {
    limitsRequired: false,
    packageName,
    visibility: "unpublished",
  }
}

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function normalizePackageName(packageName: string | undefined): string | null {
  const normalized = packageName?.trim()
  return normalized ? normalized : null
}

export class SkillShareInfoStore {
  private readonly inFlightByPackageName = new Map<string, Promise<SkillShareInfo>>()
  private readonly listeners = new Set<SkillShareInfoListener>()
  private readonly load: SkillShareInfoStoreOptions["load"]
  private readonly now: () => number
  private readonly staleTimeMs: number
  private generation = 0
  private readonly requestTokenByPackageName = new Map<string, number>()
  private snapshot: SkillShareInfoSnapshot = {}

  public constructor(options: SkillShareInfoStoreOptions) {
    this.load = options.load
    this.now = options.now ?? Date.now
    this.staleTimeMs = options.staleTimeMs ?? defaultStaleTimeMs
  }

  public getSnapshot(): SkillShareInfoSnapshot {
    return this.snapshot
  }

  public subscribe(listener: SkillShareInfoListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public ensure(packageNames: readonly (string | undefined)[]): void {
    for (const packageName of packageNames) {
      void this.refreshPackage(packageName).catch(() => {})
    }
  }

  public refreshPackage(
    packageName: string | undefined,
    options: { forceRefresh?: boolean } = {},
  ): Promise<SkillShareInfo> {
    const normalizedPackageName = normalizePackageName(packageName)

    if (!normalizedPackageName) {
      return Promise.resolve({
        limitsRequired: false,
        visibility: "unpublished",
      })
    }

    const current = this.snapshot[normalizedPackageName]
    if (
      !options.forceRefresh &&
      current?.info &&
      current.updatedAt !== null &&
      this.now() - current.updatedAt < this.staleTimeMs
    ) {
      return Promise.resolve(current.info)
    }

    const inFlight = this.inFlightByPackageName.get(normalizedPackageName)
    if (inFlight) {
      return inFlight
    }

    if (!current?.info) {
      this.setEntry(normalizedPackageName, {
        error: null,
        info: null,
        status: "loading",
        updatedAt: null,
      })
    }

    const generation = this.generation
    const requestToken = this.nextRequestToken(normalizedPackageName)
    const request = this.load({ packageName: normalizedPackageName })
      .then((info) => {
        const nextInfo = {
          ...info,
          packageName: info.packageName ?? normalizedPackageName,
        }
        if (generation === this.generation && this.isCurrentRequest(normalizedPackageName, requestToken)) {
          this.setEntry(normalizedPackageName, {
            error: null,
            info: nextInfo,
            status: "ready",
            updatedAt: this.now(),
          })
        }
        return nextInfo
      })
      .catch((cause: unknown) => {
        const fallback = createUnpublishedShareInfo(normalizedPackageName)
        if (generation === this.generation && this.isCurrentRequest(normalizedPackageName, requestToken)) {
          this.setEntry(normalizedPackageName, {
            error: toErrorMessage(cause),
            info: fallback,
            status: "ready",
            updatedAt: this.now(),
          })
        }
        return fallback
      })
      .finally(() => {
        if (generation === this.generation && this.isCurrentRequest(normalizedPackageName, requestToken)) {
          this.inFlightByPackageName.delete(normalizedPackageName)
        }
      })

    this.inFlightByPackageName.set(normalizedPackageName, request)
    return request
  }

  public setInfo(packageName: string | undefined, info: SkillShareInfo): void {
    const normalizedPackageName = normalizePackageName(packageName ?? info.packageName)
    if (!normalizedPackageName) {
      return
    }

    this.nextRequestToken(normalizedPackageName)
    this.inFlightByPackageName.delete(normalizedPackageName)
    this.setEntry(normalizedPackageName, {
      error: null,
      info: {
        ...info,
        packageName: info.packageName ?? normalizedPackageName,
      },
      status: "ready",
      updatedAt: this.now(),
    })
  }

  public invalidateAll(): void {
    this.generation += 1
    this.inFlightByPackageName.clear()

    if (Object.keys(this.snapshot).length === 0) {
      return
    }

    this.snapshot = {}
    this.emit()
  }

  private setEntry(packageName: string, entry: SkillShareInfoEntry): void {
    this.snapshot = {
      ...this.snapshot,
      [packageName]: entry,
    }
    this.emit()
  }

  private nextRequestToken(packageName: string): number {
    const token = (this.requestTokenByPackageName.get(packageName) ?? 0) + 1
    this.requestTokenByPackageName.set(packageName, token)
    return token
  }

  private isCurrentRequest(packageName: string, token: number): boolean {
    return this.requestTokenByPackageName.get(packageName) === token
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
