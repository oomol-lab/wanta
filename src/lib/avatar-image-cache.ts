const avatarCacheMaxEntries = 128
const avatarFailureTtlMs = 60_000

interface AvatarCacheEntry {
  lastUsedAt: number
  objectUrl: string
}

interface AvatarFailureEntry {
  expiresAt: number
}

export interface AvatarImageCacheFetchOptions {
  createObjectUrl?: (blob: Blob) => string
  fetcher?: typeof fetch
  now?: () => number
  revokeObjectUrl?: (url: string) => void
}

const avatarCache = new Map<string, AvatarCacheEntry>()
const avatarFailures = new Map<string, AvatarFailureEntry>()
const avatarInFlight = new Map<string, Promise<string>>()

function currentTime(options: AvatarImageCacheFetchOptions = {}): number {
  return options.now?.() ?? Date.now()
}

export function normalizeAvatarCacheKey(src: string | undefined): string | null {
  const trimmed = src?.trim()
  if (!trimmed) {
    return null
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "blob:" || url.protocol === "data:") {
      return url.href
    }
    return null
  } catch {
    return null
  }
}

export function readCachedAvatarImage(src: string | undefined, now = Date.now()): string | null {
  const key = normalizeAvatarCacheKey(src)
  if (!key) {
    return null
  }
  const cached = avatarCache.get(key)
  if (!cached) {
    return null
  }
  cached.lastUsedAt = now
  return cached.objectUrl
}

export function shouldSkipAvatarImageLoad(src: string | undefined, now = Date.now()): boolean {
  const key = normalizeAvatarCacheKey(src)
  if (!key) {
    return true
  }
  const failure = avatarFailures.get(key)
  if (!failure) {
    return false
  }
  if (failure.expiresAt <= now) {
    avatarFailures.delete(key)
    return false
  }
  return true
}

export function markAvatarImageFailed(src: string | undefined, now = Date.now()): void {
  const key = normalizeAvatarCacheKey(src)
  if (!key) {
    return
  }
  avatarFailures.set(key, { expiresAt: now + avatarFailureTtlMs })
}

export function clearAvatarImageFailure(src: string | undefined): void {
  const key = normalizeAvatarCacheKey(src)
  if (key) {
    avatarFailures.delete(key)
  }
}

function isFetchableAvatarKey(key: string): boolean {
  const protocol = new URL(key).protocol
  return protocol === "http:" || protocol === "https:"
}

function putCachedAvatarImage(key: string, objectUrl: string, options: AvatarImageCacheFetchOptions = {}): void {
  const revokeObjectUrl = options.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL)
  const existing = avatarCache.get(key)
  if (existing?.objectUrl && existing.objectUrl !== objectUrl) {
    revokeObjectUrl(existing.objectUrl)
  }
  avatarCache.set(key, { lastUsedAt: currentTime(options), objectUrl })

  if (avatarCache.size <= avatarCacheMaxEntries) {
    return
  }

  const staleEntries = Array.from(avatarCache.entries()).sort(
    ([, left], [, right]) => left.lastUsedAt - right.lastUsedAt,
  )
  for (const [staleKey, stale] of staleEntries.slice(0, avatarCache.size - avatarCacheMaxEntries)) {
    avatarCache.delete(staleKey)
    revokeObjectUrl(stale.objectUrl)
  }
}

export function dropCachedAvatarImage(
  src: string | undefined,
  options: Pick<AvatarImageCacheFetchOptions, "revokeObjectUrl"> = {},
): void {
  const key = normalizeAvatarCacheKey(src)
  if (!key) {
    return
  }
  const cached = avatarCache.get(key)
  if (!cached) {
    return
  }
  avatarCache.delete(key)
  const revokeObjectUrl = options.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL)
  revokeObjectUrl(cached.objectUrl)
}

export async function loadCachedAvatarImage(
  src: string | undefined,
  options: AvatarImageCacheFetchOptions = {},
): Promise<string> {
  const key = normalizeAvatarCacheKey(src)
  if (!key) {
    throw new Error("Avatar URL is invalid.")
  }
  if (!isFetchableAvatarKey(key)) {
    return key
  }
  if (shouldSkipAvatarImageLoad(key, currentTime(options))) {
    throw new Error("Avatar URL recently failed.")
  }
  const cached = readCachedAvatarImage(key, currentTime(options))
  if (cached) {
    return cached
  }

  const existing = avatarInFlight.get(key)
  if (existing) {
    return existing
  }

  const fetcher = options.fetcher ?? fetch
  const createObjectUrl = options.createObjectUrl ?? URL.createObjectURL.bind(URL)
  const promise = fetcher(key, {
    cache: "force-cache",
    credentials: "include",
    referrerPolicy: "no-referrer",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Avatar request failed: ${response.status}`)
      }
      const contentType = response.headers.get("content-type")?.toLowerCase()
      if (contentType && !contentType.startsWith("image/")) {
        throw new Error("Avatar response is not an image.")
      }
      const blob = await response.blob()
      if (blob.size === 0) {
        throw new Error("Avatar response is empty.")
      }
      const objectUrl = createObjectUrl(blob)
      putCachedAvatarImage(key, objectUrl, options)
      clearAvatarImageFailure(key)
      return objectUrl
    })
    .finally(() => {
      if (avatarInFlight.get(key) === promise) {
        avatarInFlight.delete(key)
      }
    })

  avatarInFlight.set(key, promise)
  return promise
}

export function clearAvatarImageCache(options: Pick<AvatarImageCacheFetchOptions, "revokeObjectUrl"> = {}): void {
  const revokeObjectUrl = options.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL)
  for (const cached of avatarCache.values()) {
    revokeObjectUrl(cached.objectUrl)
  }
  avatarCache.clear()
  avatarFailures.clear()
  avatarInFlight.clear()
}
