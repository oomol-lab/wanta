import type {
  ArtifactBundle,
  ArtifactBundleDisplay,
  ArtifactBundleKind,
  ArtifactItem,
  ArtifactItemOrigin,
  ChatMessage,
  LocalArtifactGroup,
} from "./common.ts"

import { createHash, randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { request as requestHttps } from "node:https"
import { isIP } from "node:net"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { logStoreReadFailure } from "../store-diagnostics.ts"
import { mimeFromPath, normalizeLocalPathCandidate } from "./artifacts.ts"
import { localArtifactItem } from "./local-artifacts.ts"

export type ArtifactBundles = Map<string, Map<string, ArtifactBundle>>

const maxMaterializedImageBytes = 32 * 1024 * 1024
const remoteImageTimeoutMs = 30_000
const maxRemoteRedirects = 3
const maxArtifactBaselineFiles = 10_000
const markdownImagePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu

interface PersistedArtifactBundles {
  version?: number
  sessions?: Record<string, Record<string, ArtifactBundle>>
}

interface ArtifactFileFingerprint {
  modifiedAt: number
  size: number
}

export interface ArtifactSessionBaseline {
  complete: boolean
  currentArtifactRoot: string
  files: ReadonlyMap<string, ArtifactFileFingerprint>
  sessionRoot: string
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function stableArtifactId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24)
}

function validBundle(value: unknown): value is ArtifactBundle {
  if (!value || typeof value !== "object") {
    return false
  }
  const bundle = value as Partial<ArtifactBundle>
  return (
    validText(bundle.id) &&
    validText(bundle.sessionId) &&
    validText(bundle.messageId) &&
    validText(bundle.rootPath) &&
    (bundle.status === "ready" || bundle.status === "partial" || bundle.status === "failed") &&
    typeof bundle.createdAt === "number" &&
    Array.isArray(bundle.items)
  )
}

function normalizeArtifactBundles(value: unknown): ArtifactBundles {
  const persisted = value && typeof value === "object" ? (value as PersistedArtifactBundles) : undefined
  const records: ArtifactBundles = new Map()
  if (persisted?.version !== 1 || !persisted.sessions || typeof persisted.sessions !== "object") {
    return records
  }
  for (const [sessionId, messages] of Object.entries(persisted.sessions)) {
    if (!validText(sessionId) || !messages || typeof messages !== "object") {
      continue
    }
    const sessionRecords = new Map<string, ArtifactBundle>()
    for (const [messageId, bundle] of Object.entries(messages)) {
      if (
        validText(messageId) &&
        validBundle(bundle) &&
        bundle.sessionId === sessionId &&
        bundle.messageId === messageId
      ) {
        sessionRecords.set(messageId, bundle)
      }
    }
    if (sessionRecords.size > 0) {
      records.set(sessionId, sessionRecords)
    }
  }
  return records
}

function serializeArtifactBundles(records: ArtifactBundles): PersistedArtifactBundles {
  const sessions: NonNullable<PersistedArtifactBundles["sessions"]> = {}
  for (const [sessionId, messages] of records) {
    if (!validText(sessionId) || messages.size === 0) {
      continue
    }
    const serializedMessages: Record<string, ArtifactBundle> = {}
    for (const [messageId, bundle] of messages) {
      if (validText(messageId) && validBundle(bundle)) {
        serializedMessages[messageId] = bundle
      }
    }
    if (Object.keys(serializedMessages).length > 0) {
      sessions[sessionId] = serializedMessages
    }
  }
  return { version: 1, sessions }
}

async function managedArtifactGroup(rootPath: string, maxItems = 200): Promise<LocalArtifactGroup | null> {
  const root = await localArtifactItem(rootPath)
  if (!root || root.kind !== "directory") {
    return null
  }
  const files: NonNullable<LocalArtifactGroup["items"]> = []
  let totalItems = 0
  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
    )) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) {
        continue
      }
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      totalItems += 1
      if (files.length >= maxItems) {
        continue
      }
      const item = await localArtifactItem(absolutePath)
      if (item) {
        files.push(item)
      }
    }
  }
  await visit(rootPath)
  return { root, items: files, totalItems, truncated: totalItems > files.length }
}

function inferredKind(group: LocalArtifactGroup): ArtifactBundleKind {
  const items = group.items
  if (items.length > 0 && items.every((item) => item.mime.startsWith("image/"))) {
    return "image_set"
  }
  if (items.length === 1) {
    const mime = items[0]?.mime ?? ""
    if (mime === "application/pdf" || mime.includes("word") || mime === "text/markdown") {
      return "document"
    }
    if (mime.includes("spreadsheet") || mime === "text/csv" || mime.includes("excel")) {
      return "spreadsheet"
    }
    if (mime.includes("presentation") || mime.includes("powerpoint")) {
      return "presentation"
    }
    if (mime === "text/html") {
      return "web_page"
    }
    if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip")) {
      return "archive"
    }
  }
  return "mixed"
}

function inferredDisplay(kind: ArtifactBundleKind, itemCount: number): ArtifactBundleDisplay {
  if (kind === "image_set") {
    return "gallery"
  }
  if (kind === "document" || kind === "web_page") {
    return itemCount === 1 ? "single" : "document"
  }
  if (kind === "spreadsheet") {
    return "table"
  }
  if (kind === "code_project") {
    return "project"
  }
  return itemCount === 1 ? "single" : "file_list"
}

function assistantMessagesForTurn(messages: readonly ChatMessage[], messageId: string): readonly ChatMessage[] {
  const messageIndex = messages.findIndex((item) => item.id === messageId && item.role === "assistant")
  if (messageIndex < 0) {
    return []
  }
  let turnStart = messageIndex
  while (turnStart > 0 && messages[turnStart - 1]?.role !== "user") {
    turnStart -= 1
  }
  return messages.slice(turnStart, messageIndex + 1).filter((message) => message.role === "assistant")
}

function markdownImageSources(messages: readonly ChatMessage[], messageId: string): string[] {
  const text = assistantMessagesForTurn(messages, messageId)
    .flatMap((message) => message.parts)
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("\n")
  if (!text) {
    return []
  }
  return [...text.matchAll(markdownImagePattern)].map((match) => (match[1] ?? match[2] ?? "").trim()).filter(Boolean)
}

export function markdownImageCount(messages: readonly ChatMessage[], messageId: string): number {
  return markdownImageSources(messages, messageId).length
}

export function generatedImagePreviewCount(messages: readonly ChatMessage[], messageId: string): number {
  const sources = assistantMessagesForTurn(messages, messageId)
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.kind === "attachment" && part.attachment?.mime.startsWith("image/") ? [part.attachment.path] : [],
    )
  sources.push(...markdownImageSources(messages, messageId))
  return new Set(
    sources.map((source) => normalizeLocalPathCandidate(source, os.homedir()) ?? source.trim()).filter(Boolean),
  ).size
}

interface AssistantArtifactSource {
  mime?: string
  name?: string
  origin: ArtifactItemOrigin
  source: string
}

function assistantArtifactSources(messages: readonly ChatMessage[], messageId: string): AssistantArtifactSource[] {
  const sources: AssistantArtifactSource[] = []
  for (const message of assistantMessagesForTurn(messages, messageId)) {
    for (const part of message.parts) {
      const attachment = part.kind === "attachment" ? part.attachment : undefined
      if (!attachment?.path) {
        continue
      }
      sources.push({
        source: attachment.path,
        name: attachment.name,
        mime: attachment.mime,
        origin: "assistant_attachment",
      })
    }
  }
  for (const source of markdownImageSources(messages, messageId)) {
    sources.push({ source, origin: "assistant_preview" })
  }
  return sources
}

function imageExtension(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/avif":
      return ".avif"
    case "image/bmp":
      return ".bmp"
    case "image/gif":
      return ".gif"
    case "image/jpeg":
      return ".jpg"
    case "image/svg+xml":
      return ".svg"
    case "image/webp":
      return ".webp"
    default:
      return ".png"
  }
}

function safeArtifactName(value: string | undefined, fallback: string, mime: string): string {
  const rawName = value?.split(/[\\/]/u).pop()?.trim() || fallback
  const extension = path.extname(rawName)
  const baseName = path.basename(rawName, extension).replace(/[^A-Za-z0-9._-]+/gu, "-") || fallback
  const usableExtension =
    extension && extension.length <= 12 && (!mime.startsWith("image/") || mimeFromPath(rawName).startsWith("image/"))
  const safeExtension = usableExtension ? extension.toLowerCase() : imageExtension(mime)
  return `${baseName}${safeExtension || imageExtension(mime)}`
}

async function uniqueArtifactTarget(root: string, fileName: string, reserved: Set<string>): Promise<string> {
  const extension = path.extname(fileName)
  const baseName = path.basename(fileName, extension)
  let target = path.join(root, fileName)
  let suffix = 2
  while (true) {
    const exists = await stat(target)
      .then(() => true)
      .catch(() => false)
    if (!exists && !reserved.has(target)) {
      reserved.add(target)
      return target
    }
    target = path.join(root, `${baseName}-${suffix}${extension}`)
    suffix += 1
  }
}

function pathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

async function artifactSessionFiles(
  sessionRoot: string,
  excludedRoot: string,
): Promise<{ complete: boolean; files: Map<string, ArtifactFileFingerprint> }> {
  const files = new Map<string, ArtifactFileFingerprint>()
  let complete = true
  const visit = async (directory: string): Promise<void> => {
    if (!complete) {
      return
    }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      complete = false
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) {
        continue
      }
      const absolutePath = path.join(directory, entry.name)
      if (pathInside(excludedRoot, absolutePath)) {
        continue
      }
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      if (files.size >= maxArtifactBaselineFiles) {
        complete = false
        return
      }
      const fileStat = await lstat(absolutePath).catch(() => null)
      if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
        continue
      }
      files.set(path.relative(sessionRoot, absolutePath), {
        modifiedAt: fileStat.mtimeMs,
        size: fileStat.size,
      })
    }
  }
  await visit(sessionRoot)
  return { complete, files }
}

/**
 * 记录本轮开始前同一会话全部旧制成品目录的文件状态。
 * 当前轮目录必须是会话目录的子目录；不满足该边界时禁用恢复，避免扫描无关路径。
 */
export async function captureArtifactSessionBaseline(
  sessionRoot: string,
  currentArtifactRoot: string,
): Promise<ArtifactSessionBaseline | null> {
  const [resolvedSessionRoot, resolvedArtifactRoot] = await Promise.all([
    realpath(sessionRoot).catch(() => null),
    realpath(currentArtifactRoot).catch(() => null),
  ])
  if (
    !resolvedSessionRoot ||
    !resolvedArtifactRoot ||
    resolvedSessionRoot === resolvedArtifactRoot ||
    !pathInside(resolvedSessionRoot, resolvedArtifactRoot)
  ) {
    return null
  }
  const snapshot = await artifactSessionFiles(resolvedSessionRoot, resolvedArtifactRoot)
  return {
    complete: snapshot.complete,
    currentArtifactRoot: resolvedArtifactRoot,
    files: snapshot.files,
    sessionRoot: resolvedSessionRoot,
  }
}

/**
 * 恢复模型误写到旧轮目录的新文件或被修改文件，并复制到当前轮目录。
 * 旧轮目录保持不变；恢复结果由当前轮的 bundle 独立归档。
 */
export async function recoverMisplacedTurnArtifacts(
  baseline: ArtifactSessionBaseline | null | undefined,
  currentArtifactRoot: string,
): Promise<Map<string, ArtifactItemOrigin>> {
  if (!baseline?.complete) {
    return new Map()
  }
  const resolvedArtifactRoot = await realpath(currentArtifactRoot).catch(() => null)
  if (!resolvedArtifactRoot || resolvedArtifactRoot !== baseline.currentArtifactRoot) {
    return new Map()
  }
  const current = await artifactSessionFiles(baseline.sessionRoot, resolvedArtifactRoot)
  if (!current.complete) {
    return new Map()
  }
  const changed = [...current.files].filter(([relativePath, fingerprint]) => {
    const previous = baseline.files.get(relativePath)
    return !previous || previous.size !== fingerprint.size || previous.modifiedAt !== fingerprint.modifiedAt
  })
  const origins = new Map<string, ArtifactItemOrigin>()
  const reservedTargets = new Set<string>()
  for (const [relativePath] of changed.sort(([left], [right]) => left.localeCompare(right))) {
    const segments = relativePath.split(path.sep)
    if (segments.length < 2) {
      continue
    }
    const source = path.join(baseline.sessionRoot, relativePath)
    const sourceStat = await lstat(source).catch(() => null)
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) {
      continue
    }
    const relativeTarget = path.join(...segments.slice(1))
    const targetDirectory = path.join(resolvedArtifactRoot, path.dirname(relativeTarget))
    if (!pathInside(resolvedArtifactRoot, targetDirectory)) {
      continue
    }
    try {
      await mkdir(targetDirectory, { recursive: true })
      const target = await uniqueArtifactTarget(targetDirectory, path.basename(relativeTarget), reservedTargets)
      await copyFile(source, target)
      origins.set(path.relative(resolvedArtifactRoot, target), "recovered_output")
    } catch (error) {
      console.warn(
        "[wanta] failed to recover misplaced turn artifact",
        error instanceof Error ? error.name : "unknown error",
      )
    }
  }
  return origins
}

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number)
  const [first = -1, second = -1] = parts
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  )
}

function privateIpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return privateIpv4(address)
  }
  const normalized = address.toLowerCase()
  if (normalized.startsWith("::ffff:")) {
    return true
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff")
  )
}

type RemoteImageFetcher = (url: URL, addresses: readonly string[], signal: AbortSignal) => Promise<Response>

interface MaterializeAssistantArtifactsOptions {
  fetcher?: RemoteImageFetcher
  resolveHostname?: (hostname: string) => Promise<string[]>
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
  if (addresses.length === 0 || addresses.some(privateIpAddress)) {
    return null
  }
  return { addresses, url }
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

function dataImage(value: string): { bytes: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)((?:;[^,]*)*),(.*)$/su.exec(value)
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

async function remoteImage(
  value: string,
  options: Required<MaterializeAssistantArtifactsOptions>,
): Promise<{ bytes: Buffer; mime: string; name?: string } | null> {
  let target = await publicHttpsTarget(value, options.resolveHostname)
  if (!target) {
    return null
  }
  for (let redirect = 0; redirect <= maxRemoteRedirects; redirect += 1) {
    const response = await options.fetcher(target.url, target.addresses, AbortSignal.timeout(remoteImageTimeoutMs))
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!location || redirect === maxRemoteRedirects) {
        return null
      }
      target = await publicHttpsTarget(new URL(location, target.url).toString(), options.resolveHostname)
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

export async function materializeAssistantArtifacts(
  messages: readonly ChatMessage[],
  messageId: string,
  artifactRoot: string,
  options: MaterializeAssistantArtifactsOptions = {},
): Promise<Map<string, ArtifactItemOrigin>> {
  const root = await realpath(artifactRoot).catch(() => null)
  if (!root) {
    return new Map()
  }
  const materializedOrigins = new Map<string, ArtifactItemOrigin>()
  const remoteOptions: Required<MaterializeAssistantArtifactsOptions> = {
    fetcher: options.fetcher ?? defaultRemoteImageFetcher,
    resolveHostname: options.resolveHostname ?? defaultResolveHostname,
  }
  const seen = new Set<string>()
  const artifacts: AssistantArtifactSource[] = []
  for (const artifact of assistantArtifactSources(messages, messageId)) {
    const candidate = artifact.source.trim()
    const source = normalizeLocalPathCandidate(candidate, os.homedir())
    const sourceKey = source ?? candidate
    if (!candidate || seen.has(sourceKey)) {
      continue
    }
    seen.add(sourceKey)
    artifacts.push(artifact)
  }
  const reservedTargets = new Set<string>()
  await Promise.all(
    artifacts.map(async (artifact, index) => {
      const candidate = artifact.source.trim()
      const source = normalizeLocalPathCandidate(candidate, os.homedir())
      try {
        if (source) {
          const [realSource, sourceStat] = await Promise.all([
            realpath(source).catch(() => null),
            stat(source).catch(() => null),
          ])
          if (!realSource || !sourceStat?.isFile()) {
            return
          }
          if (realSource === root || realSource.startsWith(`${root}${path.sep}`)) {
            return
          }
          const mime = artifact.mime ?? mimeFromPath(realSource)
          if (artifact.origin === "assistant_preview" && !mime.startsWith("image/")) {
            return
          }
          const target = await uniqueArtifactTarget(
            root,
            safeArtifactName(artifact.name ?? realSource, "artifact", mime),
            reservedTargets,
          )
          await copyFile(realSource, target)
          materializedOrigins.set(path.relative(root, target), artifact.origin)
          return
        }

        const fallback = `generated-${String(index + 1).padStart(3, "0")}`
        const data = dataImage(candidate)
        const downloaded = data ? { ...data, name: artifact.name } : await remoteImage(candidate, remoteOptions)
        if (!downloaded || (artifact.mime && !artifact.mime.startsWith("image/"))) {
          return
        }
        const target = await uniqueArtifactTarget(
          root,
          safeArtifactName(artifact.name ?? downloaded.name, fallback, downloaded.mime),
          reservedTargets,
        )
        await writeFile(target, downloaded.bytes)
        materializedOrigins.set(path.relative(root, target), artifact.origin)
      } catch (error) {
        console.warn(
          "[wanta] failed to materialize assistant artifact",
          error instanceof Error ? error.name : "unknown error",
        )
      }
    }),
  )
  return materializedOrigins
}

export async function buildArtifactBundle(input: {
  artifactRoot: string
  completedAt: number
  createdAt: number
  generatedPreviewCount: number
  messageId: string
  sessionId: string
  materializedOrigins?: ReadonlyMap<string, ArtifactItemOrigin>
}): Promise<ArtifactBundle | null> {
  const {
    artifactRoot,
    materializedOrigins = new Map<string, ArtifactItemOrigin>(),
    completedAt,
    createdAt,
    generatedPreviewCount,
    messageId,
    sessionId,
  } = input
  const group = await managedArtifactGroup(artifactRoot)
  if (!group) {
    return null
  }
  if (group.items.length === 0) {
    return generatedPreviewCount > 0
      ? {
          id: stableArtifactId(sessionId, messageId, "bundle"),
          sessionId,
          messageId,
          rootPath: artifactRoot,
          status: "failed",
          kind: "image_set",
          display: "gallery",
          items: [],
          totalItems: 0,
          truncated: false,
          createdAt,
          completedAt,
          failure: "generated_preview_not_persisted",
        }
      : null
  }
  const kind = inferredKind(group)
  const display = inferredDisplay(kind, group.items.length)
  const persistedImageCount = group.items.filter((item) => item.mime.startsWith("image/")).length
  const isPartial = generatedPreviewCount > persistedImageCount
  const items: ArtifactItem[] = group.items.map((item) => ({
    ...item,
    id: stableArtifactId(sessionId, messageId, path.relative(artifactRoot, item.path)),
    status: "ready",
    origin: materializedOrigins.get(path.relative(artifactRoot, item.path)) ?? "managed_output",
  }))
  return {
    id: stableArtifactId(sessionId, messageId, "bundle"),
    sessionId,
    messageId,
    rootPath: artifactRoot,
    status: isPartial ? "partial" : "ready",
    kind,
    display,
    items,
    totalItems: group.totalItems,
    truncated: group.truncated,
    createdAt,
    completedAt,
    ...(isPartial ? { failure: "generated_preview_not_persisted" as const } : {}),
  }
}

export function recordArtifactBundle(records: ArtifactBundles, bundle: ArtifactBundle): void {
  const sessionRecords = records.get(bundle.sessionId) ?? new Map<string, ArtifactBundle>()
  sessionRecords.set(bundle.messageId, bundle)
  records.set(bundle.sessionId, sessionRecords)
}

function cloneArtifactBundles(records: ArtifactBundles): ArtifactBundles {
  return new Map([...records].map(([sessionId, messages]) => [sessionId, new Map(messages)]))
}

export class ArtifactBundleStore {
  private readonly file: string
  private records: ArtifactBundles | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(dir: string) {
    this.file = path.join(dir, "artifact-bundles.json")
  }

  public async read(): Promise<ArtifactBundles> {
    await this.mutationQueue
    return cloneArtifactBundles(await this.loadRecords())
  }

  private async loadRecords(): Promise<ArtifactBundles> {
    if (this.records) {
      return this.records
    }
    try {
      this.records = normalizeArtifactBundles(JSON.parse(await readFile(this.file, "utf-8")))
    } catch (error) {
      logStoreReadFailure("artifact bundles", this.file, error)
      this.records = new Map()
    }
    return this.records
  }

  public async write(records: ArtifactBundles): Promise<void> {
    const snapshot = cloneArtifactBundles(records)
    await this.enqueueMutation(async () => {
      await this.persist(snapshot)
      this.records = snapshot
    })
  }

  public async record(bundle: ArtifactBundle): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = cloneArtifactBundles(await this.loadRecords())
      recordArtifactBundle(records, bundle)
      await this.persist(records)
      this.records = records
    })
  }

  public async removeSession(sessionId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = cloneArtifactBundles(await this.loadRecords())
      if (!records.delete(sessionId)) {
        return
      }
      await this.persist(records)
      this.records = records
    })
  }

  private async persist(records: ArtifactBundles): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeArtifactBundles(records), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }

  private async enqueueMutation(mutation: () => Promise<void>): Promise<void> {
    const operation = this.mutationQueue.catch(() => undefined).then(mutation)
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
  }
}
