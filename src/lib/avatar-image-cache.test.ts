import { afterEach, test, expect } from "vitest"
import {
  clearAvatarImageCache,
  dropCachedAvatarImage,
  loadCachedAvatarImage,
  markAvatarImageFailed,
  normalizeAvatarCacheKey,
  readCachedAvatarImage,
  shouldFetchAvatarImage,
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

  expect(requestInit?.credentials).toBe("include")
})

test("markAvatarImageFailed suppresses reloads for a short ttl", () => {
  markAvatarImageFailed("https://example.com/a.png", 100)
  expect(shouldSkipAvatarImageLoad("https://example.com/a.png", 60_099)).toBe(true)
  expect(shouldSkipAvatarImageLoad("https://example.com/a.png", 60_100)).toBe(false)
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
