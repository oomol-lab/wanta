import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentManager } from "../agent/manager.ts"
import type { GitTurnBaseline } from "../git/turn-diff.ts"
import type { SessionProjectStore } from "../session/project-store.ts"
import type { ArtifactRootStore, ArtifactRoots } from "./artifact-roots.ts"
import type { AuthorizationOverlayStore, AuthorizationOverlays } from "./authorization.ts"
import type {
  AgentRuntimeStatus,
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  AuthorizationInfo,
  ChatMessage,
  ChatService,
  ChatContextMention,
  ChatOrganizationSkillContext,
  ChatProjectContext,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
  LocalArtifactDisplayMode,
  LocalArtifactEntry,
  LocalArtifactEntryRole,
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPack,
  LocalArtifactPackKind,
  MessageErrorEvent,
  OpenExternalUrlRequest,
  OpenLocalPathRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SendMessageRequest,
  SetAgentOrganizationRequest,
  ShowLocalPathInFolderRequest,
  TurnFileDiffRequest,
  TurnFileDiffResult,
  TurnOutputRecord,
  TurnOutputRequest,
} from "./common.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"
import type {
  StoredTurnOutputFile,
  StoredTurnOutputRecord,
  TurnOutputRecords,
  TurnOutputStore,
} from "./turn-outputs.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { open, readdir, readFile, realpath, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { buildUnifiedDiff, captureGitTurnBaseline, collectGitTurnDiffs } from "../git/turn-diff.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  archivePreview,
  binaryDataPreview,
  isBinaryDataPreviewArtifact,
  isRtfArtifact,
  isXlsxArtifact,
  richPreviewMaxBytes,
  rtfToPlainText,
  spreadsheetPreview,
} from "./artifact-preview.ts"
import { applyArtifactRoots, recordArtifactRoot } from "./artifact-roots.ts"
import {
  extractLocalPathCandidates,
  imageMimeFromPath,
  isBroadLocalArtifactPath,
  mimeFromPath,
  normalizeLocalPathCandidate,
} from "./artifacts.ts"
import { applyAuthorizationOverlays, recordAuthorizationOverlay } from "./authorization.ts"
import { ChatService as ChatServiceName } from "./common.ts"
import { normalizeChatError } from "./error.ts"
import { applyStoppedGenerations, recordStoppedGeneration } from "./stopped-generations.ts"
import { publicTurnOutputRecord, recordTurnOutput } from "./turn-outputs.ts"

const attachmentPreviewMaxBytes = 16 * 1024 * 1024
const artifactTextPreviewMaxBytes = 512 * 1024
const artifactManifestFileName = ".wanta-artifact.json"
const userStopAbortWindowMs = 30_000
const defaultMaxDirectoryItems = 80
const maxProcessFiles = 200
const intermediateCodeExtensions = new Set([
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".dart",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".mjs",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".zsh",
])
const codeRequestPattern =
  /\b(api|app|cli|code|component|css|html|javascript|js|node|program|python|react|script|typescript|ts|website)\b|代码|脚本|程序|网页|网站|应用|组件|前端|后端|接口|库|插件|扩展|源码|项目/i

interface ActiveTurnOutput {
  artifactRoot: string
  createdAt: number
  messageId?: string
  processRoot: string
  projectBaseline?: GitTurnBaseline
  projectRoot?: string
  requestText: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/** 仅放行 http/https 的外开 URL，避免渲染层诱导主进程打开 file:// 或自定义协议。 */
function ensureExternalHttpUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened.")
  }
  return url.toString()
}

function createErrorPartId(): string {
  return `agent-error-${Date.now()}-${crypto.randomUUID()}`
}

function createMessageErrorPayload(sessionId: string, message: string, messageId?: string): MessageErrorEvent {
  const normalized = normalizeChatError(message)
  return {
    sessionId,
    ...(messageId ? { messageId } : {}),
    partId: createErrorPartId(),
    message,
    errorKind: normalized.kind,
    ...(normalized.code ? { errorCode: normalized.code } : {}),
  }
}

function messageErrorSignature(message: string): string {
  return message.trim() || message
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

export function buildContextMentionsSystem(mentions: ChatContextMention[] | undefined): string | undefined {
  if (!mentions || mentions.length === 0) {
    return undefined
  }
  const skills = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "skill" }> => mention.kind === "skill",
  )
  const connections = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "connection" }> => mention.kind === "connection",
  )
  const lines = [
    "User-selected context for this turn:",
    "- Treat these selections as explicit intent hints from the user, not as mandatory tool calls.",
    "- Use them only when they are relevant to the user's actual request.",
  ]
  if (skills.length > 0) {
    lines.push("Selected skills:")
    for (const skill of skills) {
      const detail = skill.description ? `; description: ${quoted(skill.description)}` : ""
      lines.push(`- ${quoted(skill.name)}; id: ${quoted(skill.id)}${detail}`)
    }
    lines.push(
      "The user explicitly selected these skills for this turn. If a selected skill matches the task, load and follow it before acting. If it is clearly unrelated, ignore it and proceed normally. Mention that you used it only when useful to the user.",
    )
  }
  if (connections.length > 0) {
    lines.push("Selected connections:")
    for (const connection of connections) {
      const details = [
        `service: ${quoted(connection.service)}`,
        connection.appId ? `appId: ${quoted(connection.appId)}` : "",
        connection.accountLabel ? `account: ${quoted(connection.accountLabel)}` : "",
      ].filter(Boolean)
      lines.push(`- ${quoted(connection.displayName)}; ${details.join("; ")}`)
    }
    lines.push(
      "If, after reading the user's request, a Link action is needed, consider the selected connection first. Do not use it for unrelated local files, direct answers, concrete URLs, or general browsing. Still inspect the action schema before calling connector tools.",
    )
  }
  return lines.join("\n")
}

export function buildOrganizationSkillsSystem(skills: ChatOrganizationSkillContext[] | undefined): string | undefined {
  const enabledSkills = (skills ?? []).filter((skill) => skill.id.trim() && skill.name.trim())
  if (enabledSkills.length === 0) {
    return undefined
  }

  const lines = [
    "Organization-configured skills for the active workspace:",
    "- Treat these skills as workspace guidance, not mandatory tool calls.",
    "- Use them only when they are relevant to the user's actual task.",
    "- If the user selected a different explicit context for this turn, prefer the explicit user selection.",
  ]
  for (const skill of enabledSkills) {
    const details = [
      `id: ${quoted(skill.id)}`,
      skill.packageName ? `package: ${quoted(skill.packageName)}` : "",
      skill.version ? `version: ${quoted(skill.version)}` : "",
      skill.description ? `description: ${quoted(skill.description)}` : "",
    ].filter(Boolean)
    lines.push(`- ${quoted(skill.name)}; ${details.join("; ")}`)
  }
  return lines.join("\n")
}

export function buildProjectContextSystem(project: ChatProjectContext | undefined): string | undefined {
  const projectPath = project?.path.trim()
  if (!project || !project.id.trim() || !project.name.trim() || !projectPath) {
    return undefined
  }
  const lines = [
    "Current local project context:",
    `- Project name: ${quoted(project.name)}`,
    `- Project directory: ${quoted(projectPath)}`,
    "- Treat this directory as the active project when the user's request involves code, files, repository state, local analysis, or file organization.",
    "- The shell and file tool cwd may still be Wanta's private scratch workspace; use this project directory as an absolute path instead of assuming cwd.",
    "- Do not mention the full project directory to the user unless they ask for the path or the path is necessary for the task outcome.",
    "- For edits to existing project files, modify files in place under this directory. Use the artifact directory only for exported deliverables, generated assets, converted files, reports, or packaged outputs.",
  ]
  if (project.git?.repositoryRoot) {
    lines.push(`- Git repository root: ${quoted(project.git.repositoryRoot)}`)
    if (project.git.currentBranch) {
      lines.push(`- Current Git branch: ${quoted(project.git.currentBranch)}`)
    } else if (project.git.detachedHead) {
      lines.push(`- Git is in detached HEAD at ${quoted(project.git.detachedHead)}`)
    }
    if (project.git.dirty) {
      lines.push(
        "- The Git worktree has uncommitted changes; inspect status before branch changes or destructive edits.",
      )
    }
  }
  return lines.join("\n")
}

function mergeSystemPrompts(...parts: Array<string | undefined>): string | undefined {
  const merged = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
  return merged || undefined
}

interface ChatServiceDeps {
  artifactRootStore?: ArtifactRootStore
  authorizationOverlayStore?: AuthorizationOverlayStore
  projectStore?: Pick<SessionProjectStore, "read">
  stoppedGenerationStore?: StoppedGenerationStore
  turnOutputStore?: TurnOutputStore
  /** 渲染层切换组织 workspace 时，同步 agent 的组织作用域（main 持有 agent 与 activeAgentOrganizationName）。 */
  onSetAgentOrganization?: (organizationName: string | undefined) => Promise<void> | void
}

interface SessionGeneration {
  controller: AbortController
  id: string
}

export function isAbortErrorMessage(message: string): boolean {
  const normalized = message
    .trim()
    .replace(/[.!。]+$/, "")
    .toLowerCase()
  return (
    normalized === "aborted" ||
    normalized === "aborterror" ||
    normalized.startsWith("aborterror:") ||
    normalized === "abort error" ||
    normalized === "the operation was aborted" ||
    normalized === "this operation was aborted" ||
    normalized.includes("operation was aborted")
  )
}

function attachmentPreviewMime(req: AttachmentPreviewRequest): string | null {
  if (req.mime.toLowerCase().startsWith("image/")) {
    return req.mime
  }
  return imageMimeFromPath(req.path)
}

function isTextArtifactMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "application/xml" ||
    mime === "application/yaml" ||
    mime === "application/x-yaml"
  )
}

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.includes(0)
}

async function readTextPreview(filePath: string, size: number): Promise<{ text: string; truncated: boolean } | null> {
  const length = Math.min(size, artifactTextPreviewMaxBytes)
  if (length <= 0) {
    return { text: "", truncated: false }
  }
  const file = await open(filePath, "r")
  try {
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await file.read(bytes, 0, length, 0)
    const chunk = bytes.subarray(0, bytesRead)
    if (isProbablyBinary(chunk)) {
      return null
    }
    return {
      text: chunk.toString("utf8"),
      truncated: size > bytesRead,
    }
  } finally {
    await file.close()
  }
}

function localArtifactName(filePath: string): string {
  return path.basename(filePath.replace(/[\\/]+$/, "")) || filePath
}

function turnOutputFileName(filePath: string): string {
  return path.basename(filePath.replace(/[\\/]+$/, "")) || filePath
}

function fileExtension(filePath: string): string {
  const name = turnOutputFileName(filePath)
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index).toLowerCase()
}

function sourceRequestsCode(requestText: string): boolean {
  return codeRequestPattern.test(requestText)
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/[\\/]+$/, "")
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function summarizeTurnFiles(files: StoredTurnOutputFile[], artifactCount: number): StoredTurnOutputRecord["summary"] {
  return {
    artifactCount,
    processFileCount: files.filter((file) => file.role === "process").length,
    changedFileCount: files.filter((file) => file.role === "project_change").length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

async function listProcessFiles(rootDir: string): Promise<string[]> {
  const root = path.resolve(rootDir)
  const found: string[] = []
  async function visit(dir: string): Promise<void> {
    if (found.length >= maxProcessFiles) {
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      if (found.length >= maxProcessFiles || entry.name === ".DS_Store") {
        continue
      }
      const absolute = path.join(dir, entry.name)
      if (!isPathInside(root, absolute)) {
        continue
      }
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (entry.isFile()) {
        found.push(path.relative(root, absolute))
      }
    }
  }
  await visit(root)
  return found
}

async function processFileEntry(rootDir: string, relativePath: string): Promise<StoredTurnOutputFile | null> {
  const absolutePath = path.join(rootDir, relativePath)
  const item = await localArtifactItem(absolutePath)
  if (!item || item.kind !== "file") {
    return null
  }
  const preview = await readTextPreview(absolutePath, item.size ?? 0).catch(() => null)
  const diff = preview
    ? buildUnifiedDiff(relativePath, "", preview.text, item.mime)
    : ({
        kind: item.size && item.size > artifactTextPreviewMaxBytes ? "too_large" : "binary",
        path: relativePath,
        mime: item.mime,
        additions: 0,
        deletions: 0,
        ...(item.size && item.size > artifactTextPreviewMaxBytes ? { truncated: true } : {}),
      } satisfies TurnFileDiffResult)
  return {
    path: absolutePath,
    name: turnOutputFileName(relativePath),
    role: "process",
    changeKind: "added",
    mime: item.mime,
    additions: diff.additions,
    deletions: diff.deletions,
    ...(diff.kind === "binary" ? { binary: true } : {}),
    ...(item.size !== undefined ? { size: item.size } : {}),
    ...(diff.truncated ? { truncated: true } : {}),
    diff: { ...diff, path: absolutePath },
  }
}

async function processOutputFiles(processRoot: string): Promise<StoredTurnOutputFile[]> {
  const entries = await Promise.all(
    (await listProcessFiles(processRoot)).map((relativePath) => processFileEntry(processRoot, relativePath)),
  )
  return entries.filter((entry): entry is StoredTurnOutputFile => Boolean(entry))
}

function artifactPackVisiblePaths(pack: LocalArtifactPack | null): Set<string> {
  if (!pack) {
    return new Set()
  }
  return new Set(
    [...pack.items, ...pack.supporting.filter((item) => item.role !== "metadata")].map((item) => item.path),
  )
}

async function intermediateArtifactProcessFiles(
  artifactRoot: string,
  requestText: string,
): Promise<StoredTurnOutputFile[]> {
  if (sourceRequestsCode(requestText)) {
    return []
  }
  const pack = await readArtifactPack(artifactRoot)
  const visiblePaths = artifactPackVisiblePaths(pack)
  const relativePaths = (await listProcessFiles(artifactRoot)).filter((relativePath) => {
    const absolutePath = path.join(artifactRoot, relativePath)
    return !visiblePaths.has(absolutePath) && intermediateCodeExtensions.has(fileExtension(relativePath))
  })
  const entries = await Promise.all(relativePaths.map((relativePath) => processFileEntry(artifactRoot, relativePath)))
  return entries.filter((entry): entry is StoredTurnOutputFile => Boolean(entry))
}

async function localArtifactItem(filePath: string): Promise<LocalArtifactItem | null> {
  try {
    const info = await stat(filePath)
    const kind = info.isDirectory() ? "directory" : "file"
    return {
      path: filePath,
      name: localArtifactName(filePath),
      kind,
      mime: kind === "directory" ? "inode/directory" : mimeFromPath(filePath),
      ...(kind === "file" ? { size: info.size } : {}),
      modifiedAt: info.mtimeMs,
    }
  } catch {
    return null
  }
}

async function directoryArtifacts(dirPath: string, maxItems: number): Promise<LocalArtifactGroup | null> {
  const root = await localArtifactItem(dirPath)
  if (!root || root.kind !== "directory") {
    return null
  }
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return { root, items: [], totalItems: 0, truncated: false }
  }
  const sorted = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    })
  const selected = sorted.slice(0, maxItems)
  const items = (await Promise.all(selected.map((entry) => localArtifactItem(path.join(dirPath, entry.name))))).filter(
    (item): item is LocalArtifactItem => Boolean(item),
  )
  return {
    root,
    items,
    totalItems: sorted.length,
    truncated: sorted.length > selected.length,
  }
}

async function fileArtifact(filePath: string): Promise<LocalArtifactGroup | null> {
  const item = await localArtifactItem(filePath)
  if (!item || item.kind !== "file") {
    return null
  }
  return { items: [item], totalItems: 1, truncated: false }
}

const artifactPackKinds = new Set<LocalArtifactPackKind>([
  "image_set",
  "document",
  "spreadsheet",
  "presentation",
  "web_page",
  "code_project",
  "archive",
  "mixed",
])
const artifactDisplayModes = new Set<LocalArtifactDisplayMode>([
  "gallery",
  "document",
  "table",
  "project",
  "file_list",
  "single",
])
const artifactEntryRoles = new Set<LocalArtifactEntryRole>(["primary", "supporting", "summary", "metadata"])

interface ArtifactManifestItem {
  path?: unknown
  title?: unknown
  description?: unknown
  role?: unknown
  order?: unknown
}

interface ArtifactManifest {
  title?: unknown
  kind?: unknown
  display?: unknown
  summary?: unknown
  primary?: unknown
  items?: unknown
  supporting?: unknown
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeArtifactPackKind(value: unknown): LocalArtifactPackKind {
  return typeof value === "string" && artifactPackKinds.has(value as LocalArtifactPackKind)
    ? (value as LocalArtifactPackKind)
    : "mixed"
}

function normalizeArtifactDisplayMode(value: unknown): LocalArtifactDisplayMode {
  return typeof value === "string" && artifactDisplayModes.has(value as LocalArtifactDisplayMode)
    ? (value as LocalArtifactDisplayMode)
    : "file_list"
}

function normalizeArtifactEntryRole(value: unknown, fallback: LocalArtifactEntryRole): LocalArtifactEntryRole {
  return typeof value === "string" && artifactEntryRoles.has(value as LocalArtifactEntryRole)
    ? (value as LocalArtifactEntryRole)
    : fallback
}

function manifestItems(value: unknown): ArtifactManifestItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is ArtifactManifestItem => Boolean(item && typeof item === "object"))
}

function primaryPathItems(value: unknown): ArtifactManifestItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item, index) => ({ path: item, role: "primary", order: index + 1 }))
}

async function resolveArtifactManifestPath(rootDir: string, value: unknown): Promise<string | null> {
  const relativePath = optionalString(value)
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith("~")) {
    return null
  }
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  try {
    const [realRoot, realResolved] = await Promise.all([realpath(root), realpath(resolved)])
    if (realResolved !== realRoot && !realResolved.startsWith(`${realRoot}${path.sep}`)) {
      return null
    }
  } catch {
    return null
  }
  return resolved
}

async function artifactManifestEntry(
  rootDir: string,
  raw: ArtifactManifestItem,
  fallbackRole: LocalArtifactEntryRole,
  fallbackOrder: number,
  seen: Set<string>,
): Promise<LocalArtifactEntry | null> {
  const filePath = await resolveArtifactManifestPath(rootDir, raw.path)
  if (!filePath || seen.has(filePath)) {
    return null
  }
  const item = await localArtifactItem(filePath)
  if (!item) {
    return null
  }
  seen.add(filePath)
  const order = typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : fallbackOrder
  return {
    ...item,
    role: normalizeArtifactEntryRole(raw.role, fallbackRole),
    order,
    ...(optionalString(raw.title) ? { title: optionalString(raw.title) } : {}),
    ...(optionalString(raw.description) ? { description: optionalString(raw.description) } : {}),
  }
}

function artifactPackVisibleCount(primaryItems: LocalArtifactEntry[], supportingItems: LocalArtifactEntry[]): number {
  const supportingVisibleCount = supportingItems.filter((item) => item.role !== "metadata").length
  return primaryItems.length + supportingVisibleCount
}

function normalizeArtifactManifestEntries(
  primaryItems: LocalArtifactEntry[],
  supportingItems: LocalArtifactEntry[],
): { primaryItems: LocalArtifactEntry[]; supportingItems: LocalArtifactEntry[] } {
  if (primaryItems.length > 0) {
    return { primaryItems, supportingItems }
  }
  const visibleSupportingItems = supportingItems.filter((item) => item.role !== "metadata")
  if (visibleSupportingItems.length !== 1) {
    return { primaryItems, supportingItems }
  }
  const promoted = { ...visibleSupportingItems[0], role: "primary" as const, order: 1 }
  return {
    primaryItems: [promoted],
    supportingItems: supportingItems.filter((item) => item.path !== promoted.path),
  }
}

async function readArtifactPack(rootDir: string): Promise<LocalArtifactPack | null> {
  const root = await localArtifactItem(rootDir)
  if (!root || root.kind !== "directory") {
    return null
  }
  let manifest: ArtifactManifest
  try {
    manifest = JSON.parse(await readFile(path.join(rootDir, artifactManifestFileName), "utf-8")) as ArtifactManifest
  } catch {
    return null
  }
  if (!manifest || typeof manifest !== "object") {
    return null
  }
  const seen = new Set<string>()
  const primaryRawItems = manifestItems(manifest.items)
  const fallbackPrimaryItems = primaryRawItems.length > 0 ? [] : primaryPathItems(manifest.primary)
  const supportingRawItems = manifestItems(manifest.supporting)
  const resolvedItems = await Promise.all(
    [...primaryRawItems, ...fallbackPrimaryItems].map((item, index) =>
      artifactManifestEntry(rootDir, item, "primary", index + 1, seen),
    ),
  )
  const primaryItems = resolvedItems
    .filter((item): item is LocalArtifactEntry => Boolean(item))
    .filter((item) => item.role === "primary")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const secondaryFromItems = resolvedItems
    .filter((item): item is LocalArtifactEntry => Boolean(item))
    .filter((item) => item.role !== "primary")
  const resolvedSupporting = await Promise.all(
    supportingRawItems.map((item, index) => artifactManifestEntry(rootDir, item, "supporting", index + 1, seen)),
  )
  const supportingItems = [
    ...secondaryFromItems,
    ...resolvedSupporting.filter((item): item is LocalArtifactEntry => Boolean(item)),
  ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const normalized = normalizeArtifactManifestEntries(primaryItems, supportingItems)
  if (normalized.primaryItems.length === 0 && normalized.supportingItems.length === 0) {
    return null
  }
  return {
    root,
    title: optionalString(manifest.title) ?? root.name,
    kind: normalizeArtifactPackKind(manifest.kind),
    display: normalizeArtifactDisplayMode(manifest.display),
    ...(optionalString(manifest.summary) ? { summary: optionalString(manifest.summary) } : {}),
    items: normalized.primaryItems,
    supporting: normalized.supportingItems,
    totalItems: artifactPackVisibleCount(normalized.primaryItems, normalized.supportingItems),
    truncated: false,
  }
}

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private emittedMessageErrors = new Map<string, Set<string>>()
  private sessionGenerations = new Map<string, SessionGeneration>()
  private pendingArtifactDirs = new Map<string, string[]>()
  private pendingProcessDirs = new Map<string, string[]>()
  private activeTurnOutputs = new Map<string, ActiveTurnOutput>()
  private activeAssistantMessages = new Map<string, string>()
  private activeToolParts = new Map<string, Set<string>>()
  private readonly deps: ChatServiceDeps
  private agentStatus: AgentRuntimeStatus = { status: "signed_out" }
  private artifactRoots: ArtifactRoots = new Map()
  private artifactRootsLoaded = false
  private artifactRootsLoadPromise: Promise<void> | null = null
  private authorizationOverlays: AuthorizationOverlays = new Map()
  private authorizationOverlaysLoaded = false
  private authorizationOverlaysLoadPromise: Promise<void> | null = null
  private authorizationOverlayWritePromise: Promise<void> = Promise.resolve()
  private stoppedGenerations: StoppedGenerations = new Map()
  private stoppedGenerationsLoaded = false
  private stoppedGenerationsLoadPromise: Promise<void> | null = null
  private turnOutputs: TurnOutputRecords = new Map()
  private turnOutputsLoaded = false
  private turnOutputsLoadPromise: Promise<void> | null = null
  private turnOutputWritePromise: Promise<void> = Promise.resolve()

  public constructor(agent: AgentManager | null = null, deps: ChatServiceDeps = {}) {
    super(ChatServiceName)
    this.agent = agent
    this.deps = deps
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
    this.bridged = false
    this.userStoppedSessions.clear()
    this.emittedMessageErrors.clear()
    this.abortSessionGenerations()
    this.sessionGenerations.clear()
    this.pendingArtifactDirs.clear()
    this.pendingProcessDirs.clear()
    this.activeTurnOutputs.clear()
    this.activeAssistantMessages.clear()
    this.activeToolParts.clear()
    this.artifactRoots.clear()
    this.artifactRootsLoaded = false
    this.artifactRootsLoadPromise = null
    this.authorizationOverlays.clear()
    this.authorizationOverlaysLoaded = false
    this.authorizationOverlaysLoadPromise = null
    this.stoppedGenerations.clear()
    this.stoppedGenerationsLoaded = false
    this.stoppedGenerationsLoadPromise = null
    this.turnOutputs.clear()
    this.turnOutputsLoaded = false
    this.turnOutputsLoadPromise = null
  }

  public setAgentStatus(status: AgentRuntimeStatus): void {
    this.agentStatus = status
    void this.send("agentStatusChanged", { status }).catch(() => undefined)
  }

  public hasActiveGeneration(): boolean {
    return (
      this.activeAssistantMessages.size > 0 ||
      this.pendingArtifactDirs.size > 0 ||
      this.pendingProcessDirs.size > 0 ||
      this.sessionGenerations.size > 0
    )
  }

  /** agent 就绪后调用：订阅 OpenCode SSE，转译为 ServerEvents 广播给渲染层。 */
  public startEventBridge(): void {
    if (!this.agent || this.bridged) {
      return
    }
    this.bridged = true
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    this.agent.subscribe((event) => {
      for (const translated of translateOpencodeEvent(event)) {
        if (
          translated.event === "agentError" &&
          translated.data.sessionId &&
          this.consumeUserStopAbort(translated.data.sessionId, translated.data.message)
        ) {
          const sessionId = translated.data.sessionId
          const messageId = this.activeAssistantMessages.get(sessionId)
          void this.finalizeTurnOutput(sessionId, messageId)
            .catch((error: unknown) => {
              console.warn("[wanta] failed to finalize stopped turn output", error)
            })
            .finally(() => {
              this.clearSessionGeneration(sessionId)
              this.activeAssistantMessages.delete(sessionId)
              this.activeToolParts.delete(sessionId)
              this.emitSessionActivity(sessionId)
              void emit("generationStopped", { sessionId })
            })
          continue
        }
        if (this.shouldSuppressUserStoppedEvent(translated)) {
          continue
        }
        if (translated.event === "messageStarted") {
          this.emitSessionActivity(translated.data.sessionId)
        }
        if (translated.event === "messageStarted" && translated.data.role === "assistant") {
          this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
          this.activeToolParts.set(translated.data.sessionId, new Set())
          const artifactRoot = this.consumePendingArtifactDir(translated.data.sessionId)
          const processRoot = this.consumePendingProcessDir(translated.data.sessionId)
          if (artifactRoot && processRoot) {
            const activeTurn = this.activeTurnOutputs.get(translated.data.sessionId)
            if (activeTurn?.artifactRoot === artifactRoot && activeTurn.processRoot === processRoot) {
              activeTurn.messageId = translated.data.messageId
            }
          }
          if (artifactRoot) {
            void emit("messageArtifacts", {
              sessionId: translated.data.sessionId,
              messageId: translated.data.messageId,
              artifactRoot,
            })
            void this.rememberArtifactRoot(translated.data.sessionId, translated.data.messageId, artifactRoot).catch(
              (error: unknown) => {
                console.warn("[wanta] failed to record artifact root", error)
              },
            )
          }
        }
        if (translated.event === "toolCallStarted") {
          this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
          const partIds = this.activeToolParts.get(translated.data.sessionId) ?? new Set<string>()
          partIds.add(translated.data.partId)
          this.activeToolParts.set(translated.data.sessionId, partIds)
        }
        if (translated.event === "toolCallResult") {
          const partIds = this.activeToolParts.get(translated.data.sessionId)
          partIds?.delete(translated.data.partId)
          if (partIds?.size === 0) {
            this.activeToolParts.delete(translated.data.sessionId)
          }
          if (translated.data.authorization) {
            void this.rememberAuthorizationOverlay(
              translated.data.sessionId,
              translated.data.messageId,
              translated.data.partId,
              translated.data.authorization,
            ).catch((error: unknown) => {
              console.warn("[wanta] failed to record authorization overlay", error)
            })
          }
        }
        if (translated.event === "agentError" && translated.data.sessionId) {
          const sessionId = translated.data.sessionId
          const messageId = this.activeAssistantMessages.get(sessionId)
          void this.finalizeTurnOutput(sessionId, messageId)
            .catch((error: unknown) => {
              console.warn("[wanta] failed to finalize errored turn output", error)
            })
            .finally(() => {
              this.clearSessionGeneration(sessionId)
              this.activeAssistantMessages.delete(sessionId)
              this.activeToolParts.delete(sessionId)
              this.emitSessionActivity(sessionId)
              this.emitMessageError(emit, sessionId, translated.data.message, messageId)
            })
          continue
        }
        if (translated.event === "messageCompleted") {
          const sessionId = translated.data.sessionId
          const messageId = this.activeAssistantMessages.get(sessionId)
          void this.finalizeTurnOutput(sessionId, messageId)
            .catch((error: unknown) => {
              console.warn("[wanta] failed to finalize turn output", error)
            })
            .finally(() => {
              this.clearSessionGeneration(sessionId)
              this.activeAssistantMessages.delete(sessionId)
              this.activeToolParts.delete(sessionId)
              this.emitSessionActivity(sessionId)
              void emit(translated.event, translated.data)
            })
          continue
        }
        void emit(translated.event, translated.data)
      }
    })
  }

  private enqueuePendingArtifactDir(sessionId: string, artifactDir: string): void {
    const queue = this.pendingArtifactDirs.get(sessionId) ?? []
    queue.push(artifactDir)
    this.pendingArtifactDirs.set(sessionId, queue)
  }

  private enqueuePendingProcessDir(sessionId: string, processDir: string): void {
    const queue = this.pendingProcessDirs.get(sessionId) ?? []
    queue.push(processDir)
    this.pendingProcessDirs.set(sessionId, queue)
  }

  private consumePendingArtifactDir(sessionId: string): string | undefined {
    const queue = this.pendingArtifactDirs.get(sessionId)
    const artifactDir = queue?.shift()
    if (!queue || queue.length === 0) {
      this.pendingArtifactDirs.delete(sessionId)
    }
    return artifactDir
  }

  private consumePendingProcessDir(sessionId: string): string | undefined {
    const queue = this.pendingProcessDirs.get(sessionId)
    const processDir = queue?.shift()
    if (!queue || queue.length === 0) {
      this.pendingProcessDirs.delete(sessionId)
    }
    return processDir
  }

  private removePendingArtifactDir(sessionId: string, artifactDir: string): void {
    const queue = this.pendingArtifactDirs.get(sessionId)
    if (!queue) {
      return
    }
    const next = queue.filter((item) => item !== artifactDir)
    if (next.length === 0) {
      this.pendingArtifactDirs.delete(sessionId)
      return
    }
    this.pendingArtifactDirs.set(sessionId, next)
  }

  private removePendingProcessDir(sessionId: string, processDir: string): void {
    const queue = this.pendingProcessDirs.get(sessionId)
    if (!queue) {
      return
    }
    const next = queue.filter((item) => item !== processDir)
    if (next.length === 0) {
      this.pendingProcessDirs.delete(sessionId)
      return
    }
    this.pendingProcessDirs.set(sessionId, next)
  }

  private clearMessageErrorSignatures(sessionId: string): void {
    this.emittedMessageErrors.delete(sessionId)
  }

  private rememberMessageError(sessionId: string, message: string): boolean {
    const signature = messageErrorSignature(message)
    const sessionErrors = this.emittedMessageErrors.get(sessionId) ?? new Set<string>()
    if (sessionErrors.has(signature)) {
      return false
    }
    sessionErrors.add(signature)
    this.emittedMessageErrors.set(sessionId, sessionErrors)
    return true
  }

  private emitMessageError(
    emit: (event: string, data: unknown) => Promise<void>,
    sessionId: string,
    message: string,
    messageId?: string,
  ): void {
    if (!this.rememberMessageError(sessionId, message)) {
      return
    }
    void emit("messageError", createMessageErrorPayload(sessionId, message, messageId))
  }

  private beginSessionGeneration(sessionId: string): SessionGeneration {
    this.sessionGenerations.get(sessionId)?.controller.abort()
    const generation = { controller: new AbortController(), id: crypto.randomUUID() }
    this.sessionGenerations.set(sessionId, generation)
    return generation
  }

  private abortSessionGenerations(): void {
    for (const generation of this.sessionGenerations.values()) {
      generation.controller.abort()
    }
  }

  private isCurrentGeneration(sessionId: string, generationId: string): boolean {
    return this.sessionGenerations.get(sessionId)?.id === generationId
  }

  private clearSessionGeneration(sessionId: string, generationId?: string): void {
    if (generationId && !this.isCurrentGeneration(sessionId, generationId)) {
      return
    }
    this.sessionGenerations.delete(sessionId)
  }

  private markUserStopped(sessionId: string): void {
    const expiresAt = Date.now() + userStopAbortWindowMs
    this.userStoppedSessions.set(sessionId, expiresAt)
    const timer = setTimeout(() => {
      if (this.userStoppedSessions.get(sessionId) === expiresAt) {
        this.userStoppedSessions.delete(sessionId)
      }
    }, userStopAbortWindowMs)
    timer.unref?.()
  }

  private consumeUserStopAbort(sessionId: string, message: string): boolean {
    const expiresAt = this.userStoppedSessions.get(sessionId)
    if (!expiresAt) {
      return false
    }
    if (Date.now() > expiresAt) {
      this.userStoppedSessions.delete(sessionId)
      return false
    }
    if (!isAbortErrorMessage(message)) {
      return false
    }
    return true
  }

  private hasActiveUserStop(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return false
    }
    const expiresAt = this.userStoppedSessions.get(sessionId)
    if (!expiresAt) {
      return false
    }
    if (Date.now() <= expiresAt) {
      return true
    }
    this.userStoppedSessions.delete(sessionId)
    return false
  }

  private shouldSuppressUserStoppedEvent(translated: ChatEmit): boolean {
    if (!this.hasActiveUserStop(translated.data.sessionId)) {
      return false
    }
    return translated.event !== "messageCompleted"
  }

  public async isReady(): Promise<boolean> {
    return this.agentStatus.status === "ready" && (this.agent?.isReady() ?? false)
  }

  public async getAgentStatus(): Promise<AgentRuntimeStatus> {
    return this.agentStatus
  }

  public async sendMessage(req: SendMessageRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const generation = this.beginSessionGeneration(req.sessionId)
    this.userStoppedSessions.delete(req.sessionId)
    this.clearMessageErrorSignatures(req.sessionId)
    this.emitSessionActivity(req.sessionId)
    let artifactDir: string
    let processDir: string
    try {
      ;[artifactDir, processDir] = await Promise.all([
        this.agent.createArtifactDir(req.sessionId),
        this.agent.createProcessDir(req.sessionId),
      ])
    } catch (error) {
      this.clearSessionGeneration(req.sessionId, generation.id)
      throw error
    }
    if (!this.isCurrentGeneration(req.sessionId, generation.id) || generation.controller.signal.aborted) {
      return
    }
    const project = await this.projectBaseline(req.projectContext)
    this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
    this.enqueuePendingProcessDir(req.sessionId, processDir)
    this.activeTurnOutputs.set(req.sessionId, {
      artifactRoot: artifactDir,
      processRoot: processDir,
      createdAt: Date.now(),
      requestText: req.text,
      ...(project.baseline ? { projectBaseline: project.baseline } : {}),
      ...(project.projectRoot ? { projectRoot: project.projectRoot } : {}),
    })
    // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
    void this.agent
      .promptStreaming(req.sessionId, req.text, {
        attachments: req.attachments,
        artifactDir,
        processDir,
        model: req.model,
        reasoningLevel: req.reasoningLevel,
        signal: generation.controller.signal,
        system: mergeSystemPrompts(
          buildOrganizationSkillsSystem(req.organizationSkills),
          buildContextMentionsSystem(req.contextMentions),
          buildProjectContextSystem(req.projectContext),
        ),
      })
      .catch((error: unknown) => {
        this.removePendingArtifactDir(req.sessionId, artifactDir)
        this.removePendingProcessDir(req.sessionId, processDir)
        this.activeTurnOutputs.delete(req.sessionId)
        if (!this.isCurrentGeneration(req.sessionId, generation.id) || generation.controller.signal.aborted) {
          return
        }
        const messageId = this.activeAssistantMessages.get(req.sessionId)
        this.clearSessionGeneration(req.sessionId, generation.id)
        this.activeAssistantMessages.delete(req.sessionId)
        this.emitMessageError(
          this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
          req.sessionId,
          errorMessage(error),
          messageId,
        )
      })
  }

  private emitSessionActivity(sessionId: string): void {
    this.sessionActivity.emit({ sessionId, usedAt: Date.now() })
  }

  private async ensureStoppedGenerationsLoaded(): Promise<void> {
    if (this.stoppedGenerationsLoaded) {
      return
    }
    if (this.stoppedGenerationsLoadPromise) {
      return this.stoppedGenerationsLoadPromise
    }
    this.stoppedGenerationsLoadPromise = (async () => {
      this.stoppedGenerations = (await this.deps.stoppedGenerationStore?.read()) ?? new Map()
      this.stoppedGenerationsLoaded = true
      this.stoppedGenerationsLoadPromise = null
    })()
    return this.stoppedGenerationsLoadPromise
  }

  private async ensureTurnOutputsLoaded(): Promise<void> {
    if (this.turnOutputsLoaded) {
      return
    }
    if (this.turnOutputsLoadPromise) {
      return this.turnOutputsLoadPromise
    }
    this.turnOutputsLoadPromise = (async () => {
      this.turnOutputs = (await this.deps.turnOutputStore?.read()) ?? new Map()
      this.turnOutputsLoaded = true
      this.turnOutputsLoadPromise = null
    })()
    return this.turnOutputsLoadPromise
  }

  private async ensureArtifactRootsLoaded(): Promise<void> {
    if (this.artifactRootsLoaded) {
      return
    }
    if (this.artifactRootsLoadPromise) {
      return this.artifactRootsLoadPromise
    }
    this.artifactRootsLoadPromise = (async () => {
      this.artifactRoots = (await this.deps.artifactRootStore?.read()) ?? new Map()
      this.artifactRootsLoaded = true
      this.artifactRootsLoadPromise = null
    })()
    return this.artifactRootsLoadPromise
  }

  private async ensureAuthorizationOverlaysLoaded(): Promise<void> {
    if (this.authorizationOverlaysLoaded) {
      return
    }
    if (this.authorizationOverlaysLoadPromise) {
      return this.authorizationOverlaysLoadPromise
    }
    this.authorizationOverlaysLoadPromise = (async () => {
      this.authorizationOverlays = (await this.deps.authorizationOverlayStore?.read()) ?? new Map()
      this.authorizationOverlaysLoaded = true
      this.authorizationOverlaysLoadPromise = null
    })()
    return this.authorizationOverlaysLoadPromise
  }

  private async rememberArtifactRoot(sessionId: string, messageId: string, artifactRoot: string): Promise<void> {
    await this.ensureArtifactRootsLoaded()
    if (!recordArtifactRoot(this.artifactRoots, sessionId, messageId, artifactRoot)) {
      return
    }
    await this.deps.artifactRootStore?.write(this.artifactRoots)
  }

  private async rememberAuthorizationOverlay(
    sessionId: string,
    messageId: string,
    partId: string,
    authorization: AuthorizationInfo,
  ): Promise<void> {
    await this.ensureAuthorizationOverlaysLoaded()
    if (!recordAuthorizationOverlay(this.authorizationOverlays, sessionId, messageId, partId, authorization)) {
      return
    }
    const write = this.authorizationOverlayWritePromise
      .catch(() => undefined)
      .then(async () => {
        await this.deps.authorizationOverlayStore?.write(this.authorizationOverlays)
      })
    this.authorizationOverlayWritePromise = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  private async rememberStoppedGeneration(sessionId: string, messageId: string, partIds: string[]): Promise<void> {
    await this.ensureStoppedGenerationsLoaded()
    if (!recordStoppedGeneration(this.stoppedGenerations, sessionId, messageId, partIds)) {
      return
    }
    await this.deps.stoppedGenerationStore?.write(this.stoppedGenerations)
  }

  private async rememberTurnOutput(record: StoredTurnOutputRecord): Promise<void> {
    await this.ensureTurnOutputsLoaded()
    recordTurnOutput(this.turnOutputs, record)
    const write = this.turnOutputWritePromise
      .catch(() => undefined)
      .then(async () => {
        await this.deps.turnOutputStore?.write(this.turnOutputs)
      })
    this.turnOutputWritePromise = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  private async projectBaseline(project: ChatProjectContext | undefined): Promise<{
    baseline?: GitTurnBaseline
    projectRoot?: string
  }> {
    const repositoryRoot = project?.git?.repositoryRoot?.trim()
    if (!project || !repositoryRoot || !this.deps.projectStore) {
      return {}
    }
    const registered = (await this.deps.projectStore.read()).get(project.id)
    if (
      !registered ||
      registered.archivedAt ||
      normalizeProjectPath(registered.path) !== normalizeProjectPath(project.path)
    ) {
      return {}
    }
    try {
      return {
        baseline: await captureGitTurnBaseline(repositoryRoot),
        projectRoot: repositoryRoot,
      }
    } catch (error) {
      console.warn("[wanta] failed to capture project baseline", error)
      return {}
    }
  }

  private async finalizeTurnOutput(sessionId: string, messageId: string | undefined): Promise<void> {
    const active = this.activeTurnOutputs.get(sessionId)
    this.activeTurnOutputs.delete(sessionId)
    const resolvedMessageId = messageId ?? active?.messageId
    if (!active || !resolvedMessageId) {
      return
    }
    const [artifactGroup, processFiles, intermediateArtifactFiles, projectFiles] = await Promise.all([
      directoryArtifacts(active.artifactRoot, defaultMaxDirectoryItems),
      processOutputFiles(active.processRoot),
      intermediateArtifactProcessFiles(active.artifactRoot, active.requestText),
      this.projectOutputFiles(active.projectBaseline, active.projectRoot),
    ])
    const files = [...processFiles, ...intermediateArtifactFiles, ...projectFiles]
    if (files.length === 0 && !artifactGroup?.items.length) {
      return
    }
    const record: StoredTurnOutputRecord = {
      sessionId,
      messageId: resolvedMessageId,
      artifactRoot: active.artifactRoot,
      processRoot: active.processRoot,
      ...(active.projectRoot ? { projectRoot: active.projectRoot } : {}),
      createdAt: active.createdAt,
      completedAt: Date.now(),
      files,
      summary: summarizeTurnFiles(files, artifactGroup?.items.length ?? 0),
    }
    await this.rememberTurnOutput(record)
    await this.send("turnOutputUpdated", { sessionId, messageId: resolvedMessageId }).catch(() => undefined)
  }

  private async projectOutputFiles(
    baseline: GitTurnBaseline | undefined,
    projectRoot: string | undefined,
  ): Promise<StoredTurnOutputFile[]> {
    if (!baseline || !projectRoot) {
      return []
    }
    const diffs = await collectGitTurnDiffs(baseline, mimeFromPath).catch((error: unknown) => {
      console.warn("[wanta] failed to collect project diff", error)
      return []
    })
    return diffs.map((item): StoredTurnOutputFile => {
      const absolutePath = path.join(projectRoot, item.path)
      return {
        path: absolutePath,
        name: turnOutputFileName(item.path),
        role: "project_change",
        changeKind: item.changeKind,
        mime: item.diff.mime,
        additions: item.diff.additions,
        deletions: item.diff.deletions,
        ...(item.diff.kind === "binary" ? { binary: true } : {}),
        ...(item.size !== undefined ? { size: item.size } : {}),
        ...(item.diff.truncated ? { truncated: true } : {}),
        diff: { ...item.diff, path: absolutePath },
      }
    })
  }

  public async getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult> {
    const mime = attachmentPreviewMime(req)
    if (!mime) {
      return { dataUrl: null }
    }
    try {
      const info = await stat(req.path)
      if (!info.isFile() || info.size > attachmentPreviewMaxBytes) {
        return { dataUrl: null }
      }
      const bytes = await readFile(req.path)
      return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
    } catch (error) {
      console.error("[wanta] getAttachmentPreview failed", { path: req.path, error: errorMessage(error) })
      return { dataUrl: null }
    }
  }

  public async getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult> {
    const item = await localArtifactItem(req.path)
    if (!item || item.kind !== "file") {
      return { kind: "unsupported", mime: "application/octet-stream", reason: "missing" }
    }

    const size = item.size ?? 0
    if (item.mime.toLowerCase().startsWith("image/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
      }
      try {
        const bytes = await readFile(item.path)
        return {
          kind: "image",
          mime: item.mime,
          size,
          dataUrl: `data:${item.mime};base64,${bytes.toString("base64")}`,
        }
      } catch (error) {
        console.error("[wanta] getLocalArtifactPreview image failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    if (item.mime.toLowerCase().startsWith("audio/") || item.mime.toLowerCase().startsWith("video/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
      }
      try {
        const bytes = await readFile(item.path)
        return {
          kind: "media",
          mime: item.mime,
          size,
          dataUrl: `data:${item.mime};base64,${bytes.toString("base64")}`,
        }
      } catch (error) {
        console.error("[wanta] getLocalArtifactPreview media failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    if (isXlsxArtifact(item.path, item.mime)) {
      try {
        return await spreadsheetPreview(item.path, item.mime, size)
      } catch (error) {
        console.error("[wanta] getLocalArtifactPreview spreadsheet failed", {
          path: req.path,
          error: errorMessage(error),
        })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    const archive = await archivePreview(item.path, item.mime, size).catch((error: unknown) => {
      console.error("[wanta] getLocalArtifactPreview archive failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported" as const, mime: item.mime, size, reason: "read_failed" as const }
    })
    if (archive) {
      return archive
    }

    if (isRtfArtifact(item.path, item.mime)) {
      try {
        const preview = await readTextPreview(item.path, size)
        if (!preview) {
          return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
        }
        return {
          kind: "text",
          mime: item.mime,
          size,
          text: rtfToPlainText(preview.text),
          truncated: preview.truncated,
        }
      } catch (error) {
        console.error("[wanta] getLocalArtifactPreview rtf failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    if (isBinaryDataPreviewArtifact(item.path, item.mime) && size <= richPreviewMaxBytes) {
      try {
        const bytes = await readFile(item.path)
        const richPreview = binaryDataPreview(item.path, item.mime, size, bytes)
        if (richPreview) {
          return richPreview
        }
      } catch (error) {
        console.error("[wanta] getLocalArtifactPreview rich file failed", {
          path: req.path,
          error: errorMessage(error),
        })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    } else if (isBinaryDataPreviewArtifact(item.path, item.mime)) {
      return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
    }

    if (!isTextArtifactMime(item.mime)) {
      return { kind: "unsupported", mime: item.mime, size, reason: "unsupported_type" }
    }

    try {
      const preview = await readTextPreview(item.path, size)
      if (!preview) {
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
      return {
        kind: "text",
        mime: item.mime,
        size,
        text: preview.text,
        truncated: preview.truncated,
      }
    } catch (error) {
      console.error("[wanta] getLocalArtifactPreview text failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  public async getTurnOutput(req: TurnOutputRequest): Promise<TurnOutputRecord | null> {
    await this.ensureTurnOutputsLoaded()
    const record = this.turnOutputs.get(req.sessionId)?.get(req.messageId)
    return record ? publicTurnOutputRecord(record) : null
  }

  public async getTurnFileDiff(req: TurnFileDiffRequest): Promise<TurnFileDiffResult> {
    await this.ensureTurnOutputsLoaded()
    const record = this.turnOutputs.get(req.sessionId)?.get(req.messageId)
    const file = record?.files.find((item) => item.path === req.path)
    if (!record || !file) {
      return { kind: "missing", path: req.path, mime: "application/octet-stream", additions: 0, deletions: 0 }
    }
    if (file.role === "artifact" && (!record.artifactRoot || !isPathInside(record.artifactRoot, file.path))) {
      return { kind: "missing", path: req.path, mime: file.mime, additions: 0, deletions: 0 }
    }
    if (file.role === "process" && (!record.processRoot || !isPathInside(record.processRoot, file.path))) {
      return { kind: "missing", path: req.path, mime: file.mime, additions: 0, deletions: 0 }
    }
    if (file.role === "project_change" && (!record.projectRoot || !isPathInside(record.projectRoot, file.path))) {
      return { kind: "missing", path: req.path, mime: file.mime, additions: 0, deletions: 0 }
    }
    return file.diff
  }

  public async resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult> {
    const candidates = req.artifactRoot ? [req.artifactRoot] : extractLocalPathCandidates(req.text ?? "")
    const fromText = !req.artifactRoot
    const maxDirectoryItems = Math.max(1, Math.min(req.maxDirectoryItems ?? defaultMaxDirectoryItems, 200))
    const seen = new Set<string>()
    const groups: LocalArtifactGroup[] = []
    let pack: LocalArtifactPack | undefined
    for (const candidate of candidates) {
      const filePath = normalizeLocalPathCandidate(candidate, os.homedir())
      if (!filePath || seen.has(filePath)) {
        continue
      }
      if (fromText && isBroadLocalArtifactPath(filePath, os.homedir())) {
        continue
      }
      seen.add(filePath)
      const item = await localArtifactItem(filePath)
      if (!item) {
        continue
      }
      if (!pack && item.kind === "directory") {
        pack = (await readArtifactPack(filePath)) ?? undefined
      }
      const group =
        item.kind === "directory" ? await directoryArtifacts(filePath, maxDirectoryItems) : await fileArtifact(filePath)
      if (group && (group.root || group.items.length > 0)) {
        groups.push(group)
      }
    }
    return { groups, ...(pack ? { pack } : {}) }
  }

  public async openLocalPath(req: OpenLocalPathRequest): Promise<void> {
    const item = await localArtifactItem(req.path)
    if (!item) {
      throw new Error("File does not exist.")
    }
    try {
      const result = await shell.openPath(item.path)
      if (result) {
        throw new Error(result)
      }
    } catch (error) {
      throw new Error(`Failed to open local path: ${errorMessage(error)}`)
    }
  }

  public async showLocalPathInFolder(req: ShowLocalPathInFolderRequest): Promise<void> {
    shell.showItemInFolder(req.path)
  }

  public async openExternalUrl(req: OpenExternalUrlRequest): Promise<void> {
    // 渲染层（额度中心等）已自行解析好目标 URL；主进程只校验 http/https 后外开，绝不在窗口内导航。
    await shell.openExternal(ensureExternalHttpUrl(req.url))
  }

  public async setAgentOrganization(req: SetAgentOrganizationRequest): Promise<void> {
    const organizationName = req.organizationName?.trim() ? req.organizationName.trim() : undefined
    await this.deps.onSetAgentOrganization?.(organizationName)
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    if (!this.agent) {
      return
    }
    const generation = this.sessionGenerations.get(sessionId)
    generation?.controller.abort()
    this.markUserStopped(sessionId)
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    try {
      await this.agent.abort(sessionId)
    } catch (error) {
      if (messageId || !generation) {
        this.userStoppedSessions.delete(sessionId)
        throw error
      }
      console.warn("[wanta] pending generation abort failed:", error)
    }
    if (messageId) {
      await this.rememberStoppedGeneration(sessionId, messageId, partIds).catch((error: unknown) => {
        console.warn("[wanta] failed to record stopped generation", error)
      })
    }
    await this.finalizeTurnOutput(sessionId, messageId).catch((error: unknown) => {
      console.warn("[wanta] failed to finalize stopped turn output", error)
    })
    this.clearSessionGeneration(sessionId, generation?.id)
    this.pendingArtifactDirs.delete(sessionId)
    this.pendingProcessDirs.delete(sessionId)
    this.activeTurnOutputs.delete(sessionId)
    this.activeAssistantMessages.delete(sessionId)
    this.activeToolParts.delete(sessionId)
    await this.send("generationStopped", { sessionId }).catch(() => undefined)
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    const messages = await this.agent.getMessages(sessionId)
    await this.ensureArtifactRootsLoaded()
    await this.ensureAuthorizationOverlaysLoaded()
    await this.ensureStoppedGenerationsLoaded()
    return applyStoppedGenerations(
      applyAuthorizationOverlays(
        applyArtifactRoots(messages, this.artifactRoots.get(sessionId)),
        this.authorizationOverlays.get(sessionId),
      ),
      this.stoppedGenerations.get(sessionId),
    )
  }
}
