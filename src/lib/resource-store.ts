export type ResourceStatus = "idle" | "loading" | "ready" | "refreshing" | "error"

export interface ResourceLoadOptions {
  forceRefresh?: boolean
  silent?: boolean
  supersede?: boolean
}

export interface ResourceSnapshot<T> {
  data: T | null
  error: string | null
  status: ResourceStatus
  updatedAt: number | null
}

export interface ResourceView<T> extends ResourceSnapshot<T> {
  invalidate(): void
  isInitialLoading: boolean
  isRefreshing: boolean
  refresh(options?: ResourceLoadOptions): Promise<T>
  reset(): void
  setData(data: T): void
}

export interface ResourceOptions<T> {
  isEqualData?: (current: T, next: T) => boolean
  isStaleData?: (data: T) => boolean
  load(options: ResourceLoadOptions): Promise<T>
  now?: () => number
  staleTimeMs?: number
}

type ResourceListener = () => void

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function createInitialSnapshot<T>(): ResourceSnapshot<T> {
  return {
    data: null,
    error: null,
    status: "idle",
    updatedAt: null,
  }
}

export class ResourceStore<T> {
  private readonly isEqualData: (current: T, next: T) => boolean
  private readonly listeners = new Set<ResourceListener>()
  private readonly isStaleData: (data: T) => boolean
  private readonly load: ResourceOptions<T>["load"]
  private readonly now: () => number
  private readonly staleTimeMs: number
  private inFlight: Promise<T> | null = null
  private inFlightVisible = false
  private requestId = 0
  private snapshot = createInitialSnapshot<T>()

  public constructor(options: ResourceOptions<T>) {
    this.isEqualData = options.isEqualData ?? (() => false)
    this.isStaleData = options.isStaleData ?? (() => false)
    this.load = options.load
    this.now = options.now ?? Date.now
    this.staleTimeMs = options.staleTimeMs ?? 0
  }

  public getSnapshot(): ResourceSnapshot<T> {
    return this.snapshot
  }

  public subscribe(listener: ResourceListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public setData(data: T): void {
    this.supersedeInFlightRequest()
    this.snapshot = {
      data,
      error: null,
      status: "ready",
      updatedAt: this.now(),
    }
    this.emit()
  }

  public invalidate(): void {
    const previous = this.snapshot
    const hadInFlightRequest = this.inFlight !== null
    this.supersedeInFlightRequest()

    if (this.snapshot.data === null) {
      if (!hadInFlightRequest && previous.status === "idle" && previous.error === null && previous.updatedAt === null) {
        return
      }
      this.snapshot = createInitialSnapshot<T>()
      this.emit()
      return
    }

    this.snapshot = {
      ...this.snapshot,
      status: "ready",
      updatedAt: null,
    }
    this.emit()
  }

  public reset(): void {
    this.requestId += 1
    this.inFlight = null
    this.inFlightVisible = false
    this.snapshot = createInitialSnapshot<T>()
    this.emit()
  }

  public refresh(options: ResourceLoadOptions = {}): Promise<T> {
    const snapshot = this.snapshot

    if (
      !options.forceRefresh &&
      snapshot.data !== null &&
      snapshot.updatedAt !== null &&
      !this.isStaleData(snapshot.data) &&
      this.now() - snapshot.updatedAt < this.staleTimeMs
    ) {
      return Promise.resolve(snapshot.data)
    }

    if (this.inFlight && !options.forceRefresh && !options.supersede) {
      if (!options.silent && snapshot.data !== null && snapshot.status === "ready") {
        this.inFlightVisible = true
        this.snapshot = {
          ...snapshot,
          error: null,
          status: "refreshing",
        }
        this.emit()
      }
      return this.inFlight
    }

    if (!options.silent || snapshot.data === null) {
      this.snapshot = {
        ...snapshot,
        error: null,
        status: snapshot.data ? "refreshing" : "loading",
      }
      this.emit()
    }

    const requestId = this.requestId + 1
    this.requestId = requestId
    this.inFlightVisible = !options.silent
    const request = this.load(options)
      .then((data) => {
        if (requestId === this.requestId) {
          const current = this.snapshot
          const updatedAt = this.now()
          if (current.data !== null && this.isEqualData(current.data, data)) {
            this.snapshot = {
              data: current.data,
              error: null,
              status: "ready",
              updatedAt,
            }
            if (current.status !== "ready" || current.error !== null) {
              this.emit()
            }
            return data
          }

          this.snapshot = {
            data,
            error: null,
            status: "ready",
            updatedAt,
          }
          this.emit()
        }
        return data
      })
      .catch((cause: unknown) => {
        const error = toErrorMessage(cause)
        if (requestId === this.requestId) {
          if (this.inFlightVisible || this.snapshot.data === null) {
            this.snapshot = {
              ...this.snapshot,
              error,
              status: this.snapshot.data ? "ready" : "error",
            }
            this.emit()
          }
        }
        throw cause
      })
      .finally(() => {
        if (requestId === this.requestId) {
          this.inFlight = null
          this.inFlightVisible = false
        }
      })

    this.inFlight = request
    return request
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private supersedeInFlightRequest(): void {
    this.requestId += 1
    this.inFlight = null
    this.inFlightVisible = false
  }
}

export function createResource<T>(options: ResourceOptions<T>): ResourceStore<T> {
  return new ResourceStore(options)
}

export function toResourceView<T>(snapshot: ResourceSnapshot<T>, resource: ResourceStore<T>): ResourceView<T> {
  return {
    ...snapshot,
    isInitialLoading: snapshot.status === "loading" && snapshot.data === null,
    isRefreshing: snapshot.status === "refreshing",
    invalidate: () => resource.invalidate(),
    refresh: (options) => resource.refresh(options),
    reset: () => resource.reset(),
    setData: (data) => resource.setData(data),
  }
}
