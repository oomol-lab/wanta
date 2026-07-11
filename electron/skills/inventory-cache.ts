import type { SkillInventory } from "./common.ts"

interface CachedInventory {
  expiresAt: number
  inventory: SkillInventory
  writeManifest: boolean
}

interface InventoryLoadRequest {
  writeManifest: boolean
}

interface InventoryInFlight extends InventoryLoadRequest {
  generation: number
  promise: Promise<SkillInventory>
}

const defaultInventoryCacheTtlMs = 5 * 60_000

/** 技能目录由 watcher 主动失效；TTL 仅兜底发现启动时尚不存在、因而未能监听的目录。 */
export class SkillInventoryCache {
  private cached: CachedInventory | undefined
  private generation = 0
  private inFlight: InventoryInFlight | undefined
  private readonly now: () => number
  private readonly ttlMs: number

  public constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? defaultInventoryCacheTtlMs
  }

  public invalidate(): void {
    this.generation += 1
    this.cached = undefined
    this.inFlight = undefined
  }

  public get(
    request: InventoryLoadRequest,
    load: (request: InventoryLoadRequest) => Promise<SkillInventory>,
  ): Promise<SkillInventory> {
    const cached = this.cached
    if (cached && cached.expiresAt > this.now()) {
      if (!request.writeManifest || cached.writeManifest) {
        return Promise.resolve(cached.inventory)
      }
      this.invalidate()
    }

    const inFlight = this.inFlight
    if (inFlight && inFlight.generation === this.generation && (!request.writeManifest || inFlight.writeManifest)) {
      return inFlight.promise
    }
    if (inFlight) {
      this.invalidate()
    }

    return this.load(request, load)
  }

  public refresh(
    request: InventoryLoadRequest,
    load: (request: InventoryLoadRequest) => Promise<SkillInventory>,
  ): Promise<SkillInventory> {
    this.invalidate()
    return this.load(request, load)
  }

  private load(
    request: InventoryLoadRequest,
    load: (request: InventoryLoadRequest) => Promise<SkillInventory>,
  ): Promise<SkillInventory> {
    const generation = this.generation
    const promise = load(request).then((inventory) => {
      if (this.generation === generation) {
        this.cached = {
          expiresAt: this.now() + this.ttlMs,
          inventory,
          writeManifest: request.writeManifest || Boolean(this.cached?.writeManifest),
        }
      }
      return inventory
    })
    this.inFlight = { ...request, generation, promise }
    const clearInFlight = (): void => {
      if (this.inFlight?.promise === promise) {
        this.inFlight = undefined
      }
    }
    void promise.then(clearInFlight, clearInFlight)
    return promise
  }
}
