import { lookup } from "node:dns/promises"
import { request as requestHttps } from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"

const maxMaterializedImageBytes = 32 * 1024 * 1024
const remoteImageTimeoutMs = 30_000
const maxRemoteRedirects = 3

export type RemoteImageFetcher = (url: URL, addresses: readonly string[], signal: AbortSignal) => Promise<Response>

export interface MaterializeAssistantArtifactsOptions {
  fetcher?: RemoteImageFetcher
  resolveHostname?: (hostname: string) => Promise<string[]>
}

export function dataImage(value: string): { bytes: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)((?:;[^;,]*)*),(.*)$/su.exec(value)
  if (!match) {
    return null
  }
  const mime = (match[1] ?? "").toLowerCase()
  const parameters = match[2] ?? ""
  const payload = match[3] ?? ""
  if (!mime.startsWith("image/") || payload.length > maxMaterializedImageBytes * 1.5) {
    return null
  }
  try {
    const bytes = parameters.toLowerCase().includes(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8")
    return bytes.length > 0 && bytes.length <= maxMaterializedImageBytes ? { bytes, mime } : null
  } catch {
    return null
  }
}

export async function remoteImage(
  value: string,
  options: MaterializeAssistantArtifactsOptions = {},
): Promise<{ bytes: Buffer; mime: string; name?: string } | null> {
  const resolvedOptions: Required<MaterializeAssistantArtifactsOptions> = {
    fetcher: options.fetcher ?? defaultRemoteImageFetcher,
    resolveHostname: options.resolveHostname ?? defaultResolveHostname,
  }
  let target = await publicHttpsTarget(value, resolvedOptions.resolveHostname)
  if (!target) {
    return null
  }
  for (let redirect = 0; redirect <= maxRemoteRedirects; redirect += 1) {
    const response = await resolvedOptions.fetcher(
      target.url,
      target.addresses,
      AbortSignal.timeout(remoteImageTimeoutMs),
    )
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!location || redirect === maxRemoteRedirects) {
        return null
      }
      target = await publicHttpsTarget(new URL(location, target.url).toString(), resolvedOptions.resolveHostname)
      if (!target) {
        return null
      }
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
    const contentLength = Number(response.headers.get("content-length"))
    if (!mime.startsWith("image/") || (Number.isFinite(contentLength) && contentLength > maxMaterializedImageBytes)) {
      await response.body?.cancel()
      return null
    }
    const bytes = await readResponseBodyWithinLimit(response, maxMaterializedImageBytes)
    if (!bytes) {
      return null
    }
    const name = decodeURIComponent(target.url.pathname.split("/").pop() ?? "") || undefined
    return { bytes, mime, name }
  }
  return null
}

export async function readResponseBodyWithinLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (!response.body || !Number.isFinite(maxBytes) || maxBytes < 0) {
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      size += chunk.value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return size > 0
    ? Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        size,
      )
    : null
}

interface PublicHttpsTarget {
  addresses: string[]
  url: URL
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  return lookup(hostname, { all: true })
    .then((addresses) => addresses.map(({ address }) => address))
    .catch(() => [])
}

async function publicHttpsTarget(
  value: string,
  resolveHostname: (hostname: string) => Promise<string[]>,
): Promise<PublicHttpsTarget | null> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return null
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "")
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return null
  }
  const addresses = isIP(hostname) ? [hostname] : await resolveHostname(hostname)
  if (addresses.length === 0 || !addresses.every(globallyRoutableIpAddress)) {
    return null
  }
  return { addresses, url }
}

function globallyRoutableIpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return globallyRoutableIpv4(address)
  }
  return globallyRoutableIpv6(address)
}

function globallyRoutableIpv4(address: string): boolean {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [first = -1, second = -1, third = -1] = parts
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  )
}

function globallyRoutableIpv6(address: string): boolean {
  const segments = expandedIpv6Segments(address)
  if (!segments) {
    return false
  }
  const [first = 0, second = 0] = segments
  if (first < 0x2000 || first > 0x3fff) {
    return false
  }
  // IETF 特殊用途、文档、ORCHID、6to4 与基准测试网段不可作为远程制成品来源。
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) {
    return false
  }
  return !(first === 0x2002 || (first === 0x3fff && second <= 0x0fff))
}

function expandedIpv6Segments(address: string): number[] | null {
  if (isIP(address) !== 6 || address.includes(".")) {
    return null
  }
  const halves = address.toLowerCase().split("::")
  if (halves.length > 2) {
    return null
  }
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves[1] ? halves[1].split(":") : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null
  }
  const segments = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) =>
    Number.parseInt(part || "0", 16),
  )
  return segments.length === 8 && segments.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? segments
    : null
}

function pinnedHttpsResponse(url: URL, address: string, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "")
    const request = requestHttps(
      {
        headers: { accept: "image/*", host: url.host },
        hostname: address,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        port: url.port ? Number(url.port) : 443,
        servername: isIP(hostname) ? undefined : hostname,
        signal,
      },
      (message) => {
        const headers = new Headers()
        for (let index = 0; index < message.rawHeaders.length; index += 2) {
          const name = message.rawHeaders[index]
          const value = message.rawHeaders[index + 1]
          if (name && value) {
            headers.append(name, value)
          }
        }
        resolve(
          new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
            headers,
            status: message.statusCode ?? 500,
            statusText: message.statusMessage,
          }),
        )
      },
    )
    request.once("error", reject)
    request.end()
  })
}

async function defaultRemoteImageFetcher(
  url: URL,
  addresses: readonly string[],
  signal: AbortSignal,
): Promise<Response> {
  let lastError: unknown
  for (const address of addresses) {
    try {
      return await pinnedHttpsResponse(url, address, signal)
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No validated address accepted the HTTPS connection.")
}
