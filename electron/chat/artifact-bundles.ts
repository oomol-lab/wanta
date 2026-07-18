import type {
  ArtifactBundle,
  ArtifactBundleDisplay,
  ArtifactBundleKind,
  ArtifactItem,
  ArtifactItemOrigin,
  ChatMessage,
  LocalArtifactGroup,
} from "./common.ts"
import type { MaterializeAssistantArtifactsOptions } from "./safe-image-source.ts"

import { createHash } from "node:crypto"
import { copyFile, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"
import { isOperationalStateArtifact } from "./artifact-file-classification.ts"
import { mimeFromPath, normalizeLocalPathCandidate } from "./artifacts.ts"
import { localArtifactItem } from "./local-artifacts.ts"
import { extractMarkdownImageSources } from "./markdown-images.ts"
import { dataImage, remoteImage } from "./safe-image-source.ts"

export { readResponseBodyWithinLimit } from "./safe-image-source.ts"

export type ArtifactBundles = Map<string, Map<string, ArtifactBundle>>

const maxArtifactBaselineFiles = 10_000
const maxArtifactBaselineEntries = 25_000
const maxArtifactBaselineDepth = 32
const artifactBaselineScanBudgetMs = 2_000
const maxManagedArtifactEntries = 5_000
const maxManagedArtifactDepth = 24
const managedArtifactScanBudgetMs = 1_500
const maxAssistantArtifactSources = 32
const maxConcurrentArtifactMaterializations = 4
const artifactBundleKinds = new Set<ArtifactBundleKind>([
  "image_set",
  "document",
  "spreadsheet",
  "presentation",
  "web_page",
  "code_project",
  "archive",
  "mixed",
])
const artifactBundleDisplays = new Set<ArtifactBundleDisplay>([
  "gallery",
  "document",
  "table",
  "project",
  "file_list",
  "single",
])
const artifactItemOrigins = new Set<ArtifactItemOrigin>([
  "managed_output",
  "assistant_attachment",
  "assistant_preview",
  "recovered_output",
])

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
    Number.isFinite(bundle.createdAt) &&
    (bundle.completedAt === undefined ||
      (typeof bundle.completedAt === "number" && Number.isFinite(bundle.completedAt))) &&
    Boolean(bundle.kind && artifactBundleKinds.has(bundle.kind)) &&
    Boolean(bundle.display && artifactBundleDisplays.has(bundle.display)) &&
    Number.isInteger(bundle.totalItems) &&
    (bundle.totalItems ?? -1) >= 0 &&
    typeof bundle.truncated === "boolean" &&
    (bundle.failure === undefined || bundle.failure === "generated_preview_not_persisted") &&
    Array.isArray(bundle.items) &&
    bundle.items.every(
      (item) =>
        Boolean(item) &&
        validText(item.id) &&
        validText(item.path) &&
        validText(item.name) &&
        item.kind === "file" &&
        validText(item.mime) &&
        item.status === "ready" &&
        artifactItemOrigins.has(item.origin) &&
        (item.size === undefined || (typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0)) &&
        (item.modifiedAt === undefined || (typeof item.modifiedAt === "number" && Number.isFinite(item.modifiedAt))),
    )
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

async function managedArtifactGroup(
  rootPath: string,
  materializedOrigins: ReadonlyMap<string, ArtifactItemOrigin>,
  maxItems = 200,
  excludedPaths: ReadonlySet<string> = new Set(),
): Promise<LocalArtifactGroup | null> {
  const root = await localArtifactItem(rootPath)
  if (!root || root.kind !== "directory") {
    return null
  }
  const files: NonNullable<LocalArtifactGroup["items"]> = []
  const deferredOperationalStateFiles: string[] = []
  let totalItems = 0
  let visitedEntries = 0
  let scanIncomplete = false
  const deadline = Date.now() + managedArtifactScanBudgetMs
  const appendVisibleFile = async (absolutePath: string): Promise<void> => {
    totalItems += 1
    if (files.length >= maxItems) {
      return
    }
    const item = await localArtifactItem(absolutePath)
    if (item) {
      files.push(item)
    }
  }
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (
      scanIncomplete ||
      depth > maxManagedArtifactDepth ||
      visitedEntries >= maxManagedArtifactEntries ||
      Date.now() >= deadline
    ) {
      scanIncomplete = true
      return
    }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
    )) {
      visitedEntries += 1
      if (visitedEntries > maxManagedArtifactEntries || Date.now() >= deadline) {
        scanIncomplete = true
        break
      }
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) {
        continue
      }
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      if (excludedPaths.has(absolutePath)) {
        continue
      }
      const relativePath = path.relative(rootPath, absolutePath)
      if (await isOperationalStateArtifact(absolutePath, materializedOrigins.get(relativePath))) {
        deferredOperationalStateFiles.push(absolutePath)
      } else {
        await appendVisibleFile(absolutePath)
      }
    }
  }
  await visit(rootPath, 0)
  // 唯一输出永不因启发式判断而消失；只有同时存在明确成果时才收起运行状态 sidecar。
  if (totalItems === 0) {
    for (const filePath of deferredOperationalStateFiles) {
      await appendVisibleFile(filePath)
    }
  }
  return {
    root,
    items: files,
    totalItems: scanIncomplete ? Math.max(totalItems, files.length + 1) : totalItems,
    truncated: scanIncomplete || totalItems > files.length,
  }
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
  return extractMarkdownImageSources(text)
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
  let visitedEntries = 0
  const deadline = Date.now() + artifactBaselineScanBudgetMs
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (!complete) {
      return
    }
    if (depth > maxArtifactBaselineDepth || visitedEntries >= maxArtifactBaselineEntries || Date.now() >= deadline) {
      complete = false
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
      visitedEntries += 1
      if (visitedEntries > maxArtifactBaselineEntries || Date.now() >= deadline) {
        complete = false
        return
      }
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) {
        continue
      }
      const absolutePath = path.join(directory, entry.name)
      if (pathInside(excludedRoot, absolutePath)) {
        continue
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1)
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
  await visit(sessionRoot, 0)
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
  const sourceIndexes = new Map<string, number>()
  const artifacts: AssistantArtifactSource[] = []
  for (const artifact of assistantArtifactSources(messages, messageId)) {
    const candidate = artifact.source.trim()
    const source = normalizeLocalPathCandidate(candidate, os.homedir())
    const sourceKey = source ?? candidate
    if (!candidate) {
      continue
    }
    const existingIndex = sourceIndexes.get(sourceKey)
    if (existingIndex !== undefined) {
      const existing = artifacts[existingIndex]
      const artifactIsImage = artifact.origin === "assistant_preview" || artifact.mime?.startsWith("image/")
      const existingIsImage = existing?.origin === "assistant_preview" || existing?.mime?.startsWith("image/")
      if (artifactIsImage && !existingIsImage) artifacts[existingIndex] = artifact
      continue
    }
    if (artifacts.length >= maxAssistantArtifactSources) {
      continue
    }
    sourceIndexes.set(sourceKey, artifacts.length)
    artifacts.push(artifact)
  }
  const reservedTargets = new Set<string>()
  let nextArtifactIndex = 0
  const materializeNextArtifact = async (): Promise<void> => {
    while (nextArtifactIndex < artifacts.length) {
      const index = nextArtifactIndex
      nextArtifactIndex += 1
      const artifact = artifacts[index]
      if (!artifact) {
        continue
      }
      const candidate = artifact.source.trim()
      const source = normalizeLocalPathCandidate(candidate, os.homedir())
      try {
        if (source) {
          const [realSource, sourceStat] = await Promise.all([
            realpath(source).catch(() => null),
            stat(source).catch(() => null),
          ])
          if (!realSource || !sourceStat?.isFile()) {
            continue
          }
          if (realSource === root || realSource.startsWith(`${root}${path.sep}`)) {
            materializedOrigins.set(path.relative(root, realSource), artifact.origin)
            continue
          }
          const mime = artifact.mime ?? mimeFromPath(realSource)
          if (artifact.origin === "assistant_preview" && !mime.startsWith("image/")) {
            continue
          }
          const target = await uniqueArtifactTarget(
            root,
            safeArtifactName(artifact.name ?? realSource, "artifact", mime),
            reservedTargets,
          )
          await copyFile(realSource, target)
          materializedOrigins.set(path.relative(root, target), artifact.origin)
          continue
        }

        const fallback = `generated-${String(index + 1).padStart(3, "0")}`
        const data = dataImage(candidate)
        const downloaded = data ? { ...data, name: artifact.name } : await remoteImage(candidate, options)
        if (!downloaded || (artifact.mime && !artifact.mime.startsWith("image/"))) {
          continue
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
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrentArtifactMaterializations, artifacts.length) }, () =>
      materializeNextArtifact(),
    ),
  )
  return materializedOrigins
}

export async function buildArtifactBundle(input: {
  artifactRoot: string
  completedAt: number
  createdAt: number
  generatedPreviewCount: number
  excludedPaths?: ReadonlySet<string>
  messageId: string
  sessionId: string
  materializedOrigins?: ReadonlyMap<string, ArtifactItemOrigin>
}): Promise<ArtifactBundle | null> {
  const { artifactRoot, excludedPaths, materializedOrigins = new Map<string, ArtifactItemOrigin>() } = input
  const group = await managedArtifactGroup(artifactRoot, materializedOrigins, 200, excludedPaths)
  if (!group) {
    return null
  }
  return buildArtifactBundleFromGroup({ ...input, group })
}

export function buildArtifactBundleFromGroup(input: {
  artifactRoot: string
  completedAt: number
  createdAt: number
  generatedPreviewCount: number
  group: LocalArtifactGroup
  messageId: string
  sessionId: string
  materializedOrigins?: ReadonlyMap<string, ArtifactItemOrigin>
}): ArtifactBundle | null {
  const {
    artifactRoot,
    materializedOrigins = new Map<string, ArtifactItemOrigin>(),
    completedAt,
    createdAt,
    generatedPreviewCount,
    group,
    messageId,
    sessionId,
  } = input
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
  // 只计算能追溯到本轮 assistant source 的图片；目录中无关的旧图片不能掩盖物化失败。
  const persistedImageCount = group.items.filter(
    (item) => item.mime.startsWith("image/") && materializedOrigins.has(path.relative(artifactRoot, item.path)),
  ).length
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
    await atomicWriteText(this.file, JSON.stringify(serializeArtifactBundles(records), null, 2))
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
