import { afterEach, test, expect } from "vitest"
import {
  clearAvatarImageCache,
  dropCachedAvatarImage,
  loadCachedAvatarImage,
  markAvatarImageDirectFallback,
  markAvatarImageFailed,
  normalizeAvatarCacheKey,
  readCachedAvatarImage,
  refreshCachedAvatarImage,
  shouldFetchAvatarImage,
  shouldLoadAvatarImageDirectly,
  shouldSkipAvatarImageLoad,
} from "./avatar-image-cache.ts"
import { apiBaseUrl } from "./domain.ts"

afterEach(() => {
  clearAvatarImageCache({ revokeObjectUrl: () => undefined })
})

test("normalizeAvatarCacheKey accepts only image-safe URL schemes", () => {
  expect(normalizeAvatarCacheKey(" https://example.com/a.png ")).toBe("https://example.com/a.png")
  expect(normalizeAvatarCacheKey("data:image/png;base64,aa")).toBe("data:image/png;base64,aa")
  expect(normalizeAvatarCacheKey("blob:https://example.com/id")).toBe("blob:https://example.com/id")
  expect(normalizeAvatarCacheKey("javascript:alert(1)")).toBeNull()
  expect(normalizeAvatarCacheKey("/relative.png")).toBeNull()
})

test("loadCachedAvatarImage merges concurrent requests and reuses the loaded object URL", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return new Response(new Blob(["avatar"], { type: "image/png" }), {
      headers: { "content-type": "image/png" },
      status: 200,
    })
  }
  const createObjectUrl = () => "blob:avatar-1"
  const now = () => 100

  const [left, right] = await Promise.all([
    loadCachedAvatarImage(avatarUrl, { createObjectUrl, fetcher, now }),
    loadCachedAvatarImage(avatarUrl, { createObjectUrl, fetcher, now }),
  ])

  expect(left).toBe("blob:avatar-1")
  expect(right).toBe("blob:avatar-1")
  expect(calls).toBe(1)
  expect(readCachedAvatarImage(avatarUrl, 101)).toBe("blob:avatar-1")
  await expect(loadCachedAvatarImage(avatarUrl, { createObjectUrl, fetcher, now })).resolves.toBe("blob:avatar-1")
  expect(calls).toBe(1)
})

test("shouldFetchAvatarImage only fetches OOMOL-hosted avatars", () => {
  expect(shouldFetchAvatarImage(new URL("/avatar.png", apiBaseUrl).toString())).toBe(true)
  expect(shouldFetchAvatarImage("https://avatars.githubusercontent.com/u/11485791?v=4")).toBe(false)
  expect(shouldFetchAvatarImage("data:image/png;base64,aa")).toBe(false)
  expect(shouldFetchAvatarImage("blob:https://example.com/id")).toBe(false)
})

test("loadCachedAvatarImage returns third-party avatar URLs directly", async () => {
  const fetcher = async () => {
    throw new Error("Unexpected avatar fetch.")
  }

  await expect(
    loadCachedAvatarImage("https://avatars.githubusercontent.com/u/11485791?v=4", { fetcher }),
  ).resolves.toBe("https://avatars.githubusercontent.com/u/11485791?v=4")
})

test("loadCachedAvatarImage includes credentials for OOMOL-hosted avatars", async () => {
  let requestInit: RequestInit | undefined
  await loadCachedAvatarImage(new URL("/avatar.png", apiBaseUrl).toString(), {
    createObjectUrl: () => "blob:avatar-1",
    fetcher: async (_input, init) => {
      requestInit = init
      return new Response(new Blob(["avatar"], { type: "image/png" }), {
        headers: { "content-type": "image/png" },
        status: 200,
      })
    },
  })

  expect(requestInit).toMatchObject({ cache: "default", credentials: "include" })
  expect(requestInit?.signal).toBeInstanceOf(AbortSignal)
})

test("markAvatarImageFailed suppresses reloads for a short ttl", () => {
  markAvatarImageFailed("https://example.com/a.png", 100)
  expect(shouldSkipAvatarImageLoad("https://example.com/a.png", 60_099)).toBe(true)
  expect(shouldSkipAvatarImageLoad("https://example.com/a.png", 60_100)).toBe(false)
})

test("markAvatarImageDirectFallback temporarily skips the authenticated blob fetch path", () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  markAvatarImageDirectFallback(avatarUrl, 100)

  expect(shouldLoadAvatarImageDirectly(avatarUrl, 60_099)).toBe(true)
  expect(shouldLoadAvatarImageDirectly(avatarUrl, 60_100)).toBe(false)
})

test("avatar transient failure caches stay bounded", () => {
  for (let index = 0; index < 257; index += 1) {
    markAvatarImageFailed(`https://example.com/avatar-${index}.png`, 100)
    markAvatarImageDirectFallback(`https://example.com/direct-${index}.png`, 100)
  }

  expect(shouldSkipAvatarImageLoad("https://example.com/avatar-0.png", 101)).toBe(false)
  expect(shouldSkipAvatarImageLoad("https://example.com/avatar-256.png", 101)).toBe(true)
  expect(shouldLoadAvatarImageDirectly("https://example.com/direct-0.png", 101)).toBe(false)
  expect(shouldLoadAvatarImageDirectly("https://example.com/direct-256.png", 101)).toBe(true)
})

test("dropCachedAvatarImage revokes and removes the cached object URL", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  const revoked: string[] = []
  await loadCachedAvatarImage(avatarUrl, {
    createObjectUrl: () => "blob:avatar-1",
    fetcher: async () => new Response(new Blob(["avatar"], { type: "image/png" })),
    now: () => 100,
    revokeObjectUrl: (url) => revoked.push(url),
  })

  dropCachedAvatarImage(avatarUrl, { revokeObjectUrl: (url) => revoked.push(url) })

  expect(readCachedAvatarImage(avatarUrl)).toBeNull()
  expect(revoked).toEqual(["blob:avatar-1"])
})

test("dropCachedAvatarImage clears failure state even when no blob is cached", () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  markAvatarImageFailed(avatarUrl)
  markAvatarImageDirectFallback(avatarUrl)

  dropCachedAvatarImage(avatarUrl)

  expect(shouldSkipAvatarImageLoad(avatarUrl)).toBe(false)
  expect(shouldLoadAvatarImageDirectly(avatarUrl)).toBe(false)
})

test("dropCachedAvatarImage prevents an in-flight request from restoring stale avatar bytes", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  let resolveResponse: ((response: Response) => void) | undefined
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })
  const request = loadCachedAvatarImage(avatarUrl, {
    createObjectUrl: () => "blob:stale-avatar",
    fetcher: async () => responsePromise,
    revokeObjectUrl: () => undefined,
  })

  dropCachedAvatarImage(avatarUrl)
  resolveResponse?.(new Response(new Blob(["avatar"], { type: "image/png" })))

  await expect(request).rejects.toThrow("Avatar cache was cleared.")
  expect(readCachedAvatarImage(avatarUrl)).toBeNull()
})

test("clearAvatarImageCache prevents an in-flight request from repopulating the cache", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  let resolveResponse: ((response: Response) => void) | undefined
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })
  const revoked: string[] = []
  const request = loadCachedAvatarImage(avatarUrl, {
    createObjectUrl: () => "blob:stale-avatar",
    fetcher: async () => responsePromise,
    revokeObjectUrl: (url) => revoked.push(url),
  })

  clearAvatarImageCache({ revokeObjectUrl: (url) => revoked.push(url) })
  resolveResponse?.(new Response(new Blob(["avatar"], { type: "image/png" })))

  await expect(request).rejects.toThrow("Avatar cache was cleared.")
  expect(readCachedAvatarImage(avatarUrl)).toBeNull()
  expect(revoked).toEqual(["blob:stale-avatar"])
})

test("refreshCachedAvatarImage replaces a cached object URL", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  const revoked: string[] = []
  let objectUrlIndex = 0
  const createObjectUrl = () => {
    objectUrlIndex += 1
    return `blob:avatar-${objectUrlIndex}`
  }
  const fetcher = async () => new Response(new Blob(["avatar"], { type: "image/png" }))

  await loadCachedAvatarImage(avatarUrl, {
    createObjectUrl,
    fetcher,
    revokeObjectUrl: (url) => revoked.push(url),
  })
  await expect(
    refreshCachedAvatarImage(avatarUrl, {
      createObjectUrl,
      fetcher,
      revokeObjectUrl: (url) => revoked.push(url),
    }),
  ).resolves.toBe("blob:avatar-2")

  expect(readCachedAvatarImage(avatarUrl)).toBe("blob:avatar-2")
  expect(revoked).toEqual(["blob:avatar-1"])
})

test("refreshCachedAvatarImage bypasses the HTTP cache while normal loads reuse it", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  const requestCaches: Array<RequestCache | undefined> = []
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    requestCaches.push(init?.cache)
    return new Response(new Blob(["avatar"], { type: "image/png" }))
  }

  await loadCachedAvatarImage(avatarUrl, { createObjectUrl: () => "blob:avatar-1", fetcher })
  await refreshCachedAvatarImage(avatarUrl, { createObjectUrl: () => "blob:avatar-2", fetcher })

  expect(requestCaches).toEqual(["default", "reload"])
})

test("refreshCachedAvatarImage deduplicates concurrent refreshes for the same key", async () => {
  const avatarUrl = new URL("/avatar.png", apiBaseUrl).toString()
  let calls = 0
  let objectUrlIndex = 0
  const fetcher = async () => {
    calls += 1
    return new Response(new Blob(["avatar"], { type: "image/png" }))
  }
  const createObjectUrl = () => {
    objectUrlIndex += 1
    return `blob:avatar-${objectUrlIndex}`
  }

  await loadCachedAvatarImage(avatarUrl, { createObjectUrl, fetcher })
  const [left, right] = await Promise.all([
    refreshCachedAvatarImage(avatarUrl, { createObjectUrl, fetcher }),
    refreshCachedAvatarImage(avatarUrl, { createObjectUrl, fetcher }),
  ])

  expect(left).toBe("blob:avatar-2")
  expect(right).toBe("blob:avatar-2")
  expect(calls).toBe(2)
  expect(readCachedAvatarImage(avatarUrl)).toBe("blob:avatar-2")
})

test("refreshCachedAvatarImage does not invalidate other in-flight avatar keys", async () => {
  const firstUrl = new URL("/first-avatar.png", apiBaseUrl).toString()
  const secondUrl = new URL("/second-avatar.png", apiBaseUrl).toString()
  const pending = new Map<string, (response: Response) => void>()
  let objectUrlIndex = 0
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input)
    return new Promise<Response>((resolve) => {
      pending.set(url, resolve)
    })
  }
  const createObjectUrl = () => {
    objectUrlIndex += 1
    return `blob:avatar-${objectUrlIndex}`
  }

  const firstLoad = loadCachedAvatarImage(firstUrl, { createObjectUrl, fetcher })
  const secondRefresh = refreshCachedAvatarImage(secondUrl, { createObjectUrl, fetcher })
  pending.get(secondUrl)?.(new Response(new Blob(["second"], { type: "image/png" })))
  pending.get(firstUrl)?.(new Response(new Blob(["first"], { type: "image/png" })))

  const [secondResult, firstResult] = await Promise.all([secondRefresh, firstLoad])
  expect(secondResult).toMatch(/^blob:avatar-/)
  expect(firstResult).toMatch(/^blob:avatar-/)
  expect(readCachedAvatarImage(secondUrl)).toBe(secondResult)
  expect(readCachedAvatarImage(firstUrl)).toBe(firstResult)
})
