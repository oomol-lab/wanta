import type { SharedRequest } from "@/lib/shared-request"

import { createSharedRequest, waitForSharedRequest } from "@/lib/shared-request"

const skillCatalogCacheMaxEntries = 256

interface SkillCatalogCacheEntry {
  expiresAt: number
  value: unknown
}

interface SkillCatalogPendingRequest extends SharedRequest<unknown> {
  epoch: number
  generation: number
}

const skillCatalogCache = new Map<string, SkillCatalogCacheEntry>()
const skillCatalogPendingRequests = new Map<string, SkillCatalogPendingRequest>()
const skillCatalogKeyGenerations = new Map<string, number>()
let skillCatalogEpoch = 0

let invalidationRevision = 0
const invalidationListeners = new Set<() => void>()

export function getSkillCatalogInvalidationRevision(): number {
  return invalidationRevision
}

export function subscribeSkillCatalogInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener)
  return () => {
    invalidationListeners.delete(listener)
  }
}

function notifySkillCatalogInvalidation(): void {
  invalidationRevision += 1
  for (const listener of invalidationListeners) listener()
}

export function readCachedSkillCatalogValue<T>(key: string): T | undefined {
  const cached = skillCatalogCache.get(key)
  if (!cached) {
    return undefined
  }
  if (Date.now() >= cached.expiresAt) {
    skillCatalogCache.delete(key)
    if (!skillCatalogPendingRequests.has(key)) {
      skillCatalogKeyGenerations.delete(key)
    }
    return undefined
  }
  return cached.value as T
}

export function readCachedSkillCatalog<T>(
  key: string,
  cacheMs: number | ((value: T) => number),
  forceRefresh: boolean | undefined,
  load: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  if (forceRefresh) {
    invalidateSkillCatalogKey(key)
  }

  if (!forceRefresh) {
    const cached = readCachedSkillCatalogValue<T>(key)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
  }

  const epoch = skillCatalogEpoch
  const generation = skillCatalogKeyGenerations.get(key) ?? 0
  const pending = skillCatalogPendingRequests.get(key)
  if (pending?.epoch === epoch && pending.generation === generation && !pending.controller.signal.aborted) {
    return waitForSharedRequest(pending as SkillCatalogPendingRequest & SharedRequest<T>, signal)
  }

  const shared = createSharedRequest((requestSignal) =>
    load(requestSignal).then((value) => {
      if (
        !requestSignal.aborted &&
        skillCatalogEpoch === epoch &&
        (skillCatalogKeyGenerations.get(key) ?? 0) === generation
      ) {
        skillCatalogCache.set(key, {
          expiresAt: Date.now() + (typeof cacheMs === "function" ? cacheMs(value) : cacheMs),
          value,
        })
        while (skillCatalogCache.size > skillCatalogCacheMaxEntries) {
          const oldestKey = skillCatalogCache.keys().next().value as string | undefined
          if (!oldestKey) {
            break
          }
          skillCatalogCache.delete(oldestKey)
          if (!skillCatalogPendingRequests.has(oldestKey)) {
            skillCatalogKeyGenerations.delete(oldestKey)
          }
        }
      }
      return value
    }),
  )
  const request: SkillCatalogPendingRequest = Object.assign(shared, { epoch, generation })
  skillCatalogPendingRequests.set(key, request)
  void request.promise.then(
    () => {
      if (skillCatalogPendingRequests.get(key) === request) skillCatalogPendingRequests.delete(key)
    },
    () => {
      if (skillCatalogPendingRequests.get(key) === request) skillCatalogPendingRequests.delete(key)
    },
  )
  return waitForSharedRequest(request as SkillCatalogPendingRequest & SharedRequest<T>, signal)
}

function invalidateSkillCatalogKey(key: string): void {
  skillCatalogCache.delete(key)
  skillCatalogPendingRequests.delete(key)
  skillCatalogKeyGenerations.set(key, (skillCatalogKeyGenerations.get(key) ?? 0) + 1)
}

export function invalidateSkillCatalogKeys(
  predicate: (key: string) => boolean,
  options: { notify?: boolean } = {},
): void {
  const keys = new Set([
    ...skillCatalogCache.keys(),
    ...skillCatalogPendingRequests.keys(),
    ...skillCatalogKeyGenerations.keys(),
  ])
  for (const key of keys) {
    if (predicate(key)) {
      invalidateSkillCatalogKey(key)
    }
  }
  if (options.notify !== false) notifySkillCatalogInvalidation()
}

export function clearSkillCatalogCache(): void {
  skillCatalogEpoch += 1
  skillCatalogCache.clear()
  for (const request of skillCatalogPendingRequests.values()) {
    request.controller.abort(new DOMException("Skill catalog cache was cleared.", "AbortError"))
  }
  skillCatalogPendingRequests.clear()
  skillCatalogKeyGenerations.clear()
  notifySkillCatalogInvalidation()
}
