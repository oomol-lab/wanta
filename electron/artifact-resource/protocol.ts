import type { ArtifactResourceLease, ArtifactResourceLeaseStore } from "./lease-store.ts"
import type { FileHandle } from "node:fs/promises"

import { protocol } from "electron"
import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { Readable } from "node:stream"
import { branding } from "../branding.ts"

export const artifactResourceScheme = branding.artifactResourceProtocolScheme

export function registerArtifactResourceScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: artifactResourceScheme,
      privileges: { corsEnabled: true, secure: true, standard: true, stream: true, supportFetchAPI: true },
    },
  ])
}

export function artifactResourceUrl(token: string): string {
  return `${artifactResourceScheme}://artifact/${encodeURIComponent(token)}`
}

interface ByteRange {
  end: number
  start: number
}

export function parseSingleByteRange(header: string | null, size: number): ByteRange | "invalid" | null {
  if (!header) {
    return null
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) {
    return "invalid"
  }
  const startText = match[1] ?? ""
  const endText = match[2] ?? ""
  if (!startText && !endText) {
    return "invalid"
  }
  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid"
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return "invalid"
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

async function openCurrentLease(lease: ArtifactResourceLease): Promise<FileHandle | null> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  let handle: FileHandle | undefined
  try {
    handle = await open(lease.path, constants.O_RDONLY | noFollow)
    const [pathInfo, openedInfo] = await Promise.all([lstat(lease.path), handle.stat()])
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      !openedInfo.isFile() ||
      openedInfo.dev !== lease.dev ||
      openedInfo.ino !== lease.ino ||
      pathInfo.dev !== openedInfo.dev ||
      pathInfo.ino !== openedInfo.ino ||
      openedInfo.size !== lease.size ||
      openedInfo.mtimeMs !== lease.modifiedAt
    ) {
      await handle.close()
      return null
    }
    return handle
  } catch {
    await handle?.close().catch(() => undefined)
    return null
  }
}

function tokenFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.hostname !== "artifact") {
      return null
    }
    const token = decodeURIComponent(url.pathname.replace(/^\//, ""))
    return token && !token.includes("/") ? token : null
  } catch {
    return null
  }
}

export function installArtifactResourceProtocol(store: ArtifactResourceLeaseStore): void {
  protocol.handle(artifactResourceScheme, (request) => artifactResourceResponse(request, store))
}

export async function artifactResourceResponse(request: Request, store: ArtifactResourceLeaseStore): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  }
  const token = tokenFromUrl(request.url)
  const lease = token ? store.resolve(token) : null
  if (!lease) {
    return new Response(null, { status: 404 })
  }
  const handle = await openCurrentLease(lease)
  if (!handle) return new Response(null, { status: 404 })
  const range = parseSingleByteRange(request.headers.get("range"), lease.size)
  if (range === "invalid") {
    await handle.close()
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${lease.size}` } })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(lease.size - 1, 0)
  const contentLength = lease.size === 0 ? 0 : end - start + 1
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Length": String(contentLength),
    "Content-Type": lease.mime,
  })
  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${lease.size}`)
  }
  if (request.method === "HEAD" || lease.size === 0) {
    await handle.close()
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  const body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}
