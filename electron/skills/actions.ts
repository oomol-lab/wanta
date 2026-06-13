import type {
  BuiltInSkillId,
  MyPublishedSkill,
  SkillCliVersionCheck,
  SkillPackageVersionCheck,
  SkillShareInfo,
  ShareSkillRequest,
  SkillSearchResult,
  SkillShareResult,
} from "./common.ts"

import { builtInSkillIds } from "./constants.ts"

type SkillOperationCommand =
  | "skills.install"
  | "skills.sync.apply"
  | "skills.sync.upload"
  | "skills.uninstall"
  | "skills.update"

type SkillOperationStatus = "completed" | "failed" | "noop" | "partial-failure"

interface RawSkillSearchResult {
  description?: unknown
  name?: unknown
  packageName?: unknown
  packageVersion?: unknown
  skillDisplayName?: unknown
}

interface RawMyPublishedPackageListResponse {
  data?: unknown
  next?: unknown
}

interface RawMyPublishedPackageListItem {
  description?: unknown
  displayName?: unknown
  icon?: unknown
  name?: unknown
  updateTime?: unknown
  version?: unknown
  visibility?: unknown
}

interface NormalizedMyPublishedPackage {
  description?: string
  displayName: string
  icon?: string
  name: string
  updateTime?: number
  version: string
  visibility: MyPublishedSkill["visibility"]
}

interface RawRegistryPackageSkill {
  description?: unknown
  name?: unknown
  title?: unknown
}

interface RawRegistrySkillCheckUpdateResult {
  currentVersion?: unknown
  error?: unknown
  latestVersion?: unknown
  packageName?: unknown
  skillId?: unknown
  status?: unknown
}

interface RawRegistrySkillCheckUpdateError {
  message?: unknown
}

interface RawRegistrySkillCheckUpdateResponse {
  skills?: unknown
}

interface RawCliCheckUpdateResult {
  currentVersion?: unknown
  latestVersion?: unknown
  message?: unknown
  status?: unknown
}

interface RawSkillOperationResult {
  command?: unknown
  errors?: unknown
  records?: unknown
  skills?: unknown
  status?: unknown
}

interface RawSkillOperationError {
  code?: unknown
  message?: unknown
}

interface RawSkillOperationEntry {
  error?: unknown
  targets?: unknown
}

// CLI mutation targets 通常只有一层；限制深度避免异常响应导致遍历失控。
const skillOperationEntryErrorMaxDepth = 10

interface RawPackageInfoResponse {
  access?: unknown
  description?: unknown
  displayName?: unknown
  icon?: unknown
  isPrivate?: unknown
  name?: unknown
  packageName?: unknown
  packageVersion?: unknown
  skills?: unknown
  title?: unknown
  visibility?: unknown
  version?: unknown
}

export interface RegistryPackageVersionInfo {
  latestVersion?: string
  packageName?: string
}

export interface MyPublishedPackageList {
  next: string | null
  packages: NormalizedMyPublishedPackage[]
}

export interface RegistryPackageSkillInfo {
  description?: string
  displayName: string
  icon?: string
  packageName: string
  packageVersion: string
  skills: Array<{
    description?: string
    displayName: string
    name: string
  }>
  visibility: MyPublishedSkill["visibility"]
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function createSkillSearchArgs(query: string): string[] {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    throw new Error("Skill search query is empty.")
  }

  return ["skills", "search", trimmedQuery, "--json"]
}

export function createCliCheckUpdateArgs(): string[] {
  return ["check-update", "--json"]
}

export function createCliUpdateArgs(): string[] {
  return ["update"]
}

export function createRegistrySkillCheckUpdateArgs(packageNames: readonly string[] = []): string[] {
  const args = ["skills", "check-update"]
  for (const packageName of packageNames) {
    args.push(asRequiredCommandValue(packageName, "packageName"))
  }

  args.push("--json")
  return args
}

export function createRegistryPackageInfoVersionCheckCommand(packageName: string): string[] {
  return ["registry", "package-info", asRequiredCommandValue(packageName, "packageName"), "latest"]
}

export function normalizeSkillSearchResults(stdout: string): SkillSearchResult[] {
  const parsed = JSON.parse(stdout) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error("Skill search returned an unsupported response.")
  }

  return parsed.map(normalizeSkillSearchResult).filter((result): result is SkillSearchResult => Boolean(result))
}

export function normalizeMyPublishedPackageList(stdout: string): MyPublishedPackageList {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Published package list returned an unsupported response.")
  }

  const raw = parsed as RawMyPublishedPackageListResponse
  if (!Array.isArray(raw.data)) {
    throw new Error("Published package list returned an unsupported response.")
  }

  return {
    next: typeof raw.next === "string" && raw.next.trim() ? raw.next.trim() : null,
    packages: raw.data
      .map(normalizeMyPublishedPackage)
      .filter((item): item is NormalizedMyPublishedPackage => Boolean(item)),
  }
}

export function createRegistrySkillVersionCheck(
  skill: {
    id: string
    kind: "registry" | "bundled" | "local" | "unknown"
    name: string
    packageName?: string
    version?: string
  },
  results: readonly SkillSearchResult[],
): SkillPackageVersionCheck {
  const command = skill.packageName ? createSkillSearchArgs(skill.packageName) : undefined

  if (skill.kind !== "registry" || !skill.packageName) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "not-checkable",
    }
  }

  const exactMatch = results.find((result) => result.packageName === skill.packageName && result.skillId === skill.id)
  const latestVersion = exactMatch?.version

  if (!latestVersion || !skill.version) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      latestVersion,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "unknown",
    }
  }

  return {
    command,
    currentVersion: skill.version,
    id: skill.id,
    kind: skill.kind,
    latestVersion,
    name: skill.name,
    packageName: skill.packageName,
    skillId: skill.id,
    status: latestVersion === skill.version ? "current" : "update-available",
  }
}

export function normalizeRegistrySkillCheckUpdateResults(stdout: string): RawRegistrySkillCheckUpdateResult[] {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Registry Skill update check returned an unsupported response.")
  }

  const raw = parsed as RawRegistrySkillCheckUpdateResponse
  if (!Array.isArray(raw.skills)) {
    throw new Error("Registry Skill update check returned an unsupported response.")
  }

  return raw.skills.filter((entry): entry is RawRegistrySkillCheckUpdateResult =>
    Boolean(entry && typeof entry === "object"),
  )
}

export function createRegistrySkillVersionCheckFromUpdateResult(
  skill: {
    id: string
    kind: "registry" | "bundled" | "local" | "unknown"
    name: string
    packageName?: string
    version?: string
  },
  results: readonly RawRegistrySkillCheckUpdateResult[],
  command: string[],
): SkillPackageVersionCheck {
  if (skill.kind !== "registry" || !skill.packageName) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "not-checkable",
    }
  }

  const exactMatch = results.find((result) => {
    return asText(result.packageName) === skill.packageName && asText(result.skillId) === skill.id
  })

  if (!exactMatch) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "unknown",
    }
  }

  const currentVersion = asText(exactMatch.currentVersion) ?? skill.version
  const latestVersion = asText(exactMatch.latestVersion)
  const status = asText(exactMatch.status)

  if (status === "update-available") {
    return {
      command,
      currentVersion,
      id: skill.id,
      kind: skill.kind,
      latestVersion,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "update-available",
    }
  }

  if (status === "up-to-date") {
    return {
      command,
      currentVersion,
      id: skill.id,
      kind: skill.kind,
      latestVersion,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "current",
    }
  }

  if (status === "failed") {
    return {
      command,
      currentVersion,
      error: createRegistrySkillCheckUpdateErrorMessage(exactMatch.error),
      id: skill.id,
      kind: skill.kind,
      latestVersion,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "failed",
    }
  }

  return {
    command,
    currentVersion,
    id: skill.id,
    kind: skill.kind,
    latestVersion,
    name: skill.name,
    packageName: skill.packageName,
    skillId: skill.id,
    status: "unknown",
  }
}

export function createPublishedSkillVersionCheckFromPackageInfo(
  skill: {
    id: string
    kind: "registry" | "bundled" | "local" | "unknown"
    name: string
    packageName?: string
    version?: string
  },
  info: RegistryPackageVersionInfo | undefined,
  command: string[],
): SkillPackageVersionCheck {
  if (!skill.packageName) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      skillId: skill.id,
      status: "not-checkable",
    }
  }

  const latestVersion = info?.latestVersion

  if (!latestVersion || !skill.version) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      latestVersion,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "unknown",
    }
  }

  const versionOrder = comparePackageVersions(latestVersion, skill.version)

  if (versionOrder === undefined) {
    return {
      command,
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      latestVersion,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "unknown",
    }
  }

  return {
    command,
    currentVersion: skill.version,
    id: skill.id,
    kind: skill.kind,
    latestVersion,
    name: skill.name,
    packageName: skill.packageName,
    skillId: skill.id,
    status: versionOrder > 0 ? "update-available" : "current",
  }
}

export function createFailedSkillVersionCheck(
  skill: {
    id: string
    kind: "registry" | "bundled" | "local" | "unknown"
    name: string
    packageName?: string
    version?: string
  },
  error: string,
): SkillPackageVersionCheck {
  return {
    command: skill.packageName ? createSkillSearchArgs(skill.packageName) : undefined,
    currentVersion: skill.version,
    error,
    id: skill.id,
    kind: skill.kind,
    name: skill.name,
    packageName: skill.packageName,
    skillId: skill.id,
    status: "failed",
  }
}

export function createFailedRegistrySkillVersionCheck(
  skill: {
    id: string
    kind: "registry" | "bundled" | "local" | "unknown"
    name: string
    packageName?: string
    version?: string
  },
  error: string,
  command: string[],
): SkillPackageVersionCheck {
  return {
    command,
    currentVersion: skill.version,
    error,
    id: skill.id,
    kind: skill.kind,
    name: skill.name,
    packageName: skill.packageName,
    skillId: skill.id,
    status: "failed",
  }
}

export function createBundledSkillVersionCheck(
  skill: {
    id: string
    kind: "registry" | "bundled" | "local" | "unknown"
    name: string
    packageName?: string
    version?: string
  },
  cli: SkillCliVersionCheck,
): SkillPackageVersionCheck {
  if (skill.kind !== "bundled") {
    return {
      currentVersion: skill.version,
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      packageName: skill.packageName,
      skillId: skill.id,
      status: "not-checkable",
    }
  }

  return {
    command: cli.command,
    currentVersion: skill.version,
    error: cli.status === "failed" ? cli.error : undefined,
    id: skill.id,
    kind: skill.kind,
    latestVersion: cli.status === "update-available" ? cli.latestVersion : undefined,
    name: skill.name,
    packageName: skill.packageName,
    skillId: skill.id,
    status:
      cli.status === "update-available"
        ? "update-available"
        : cli.status === "failed"
          ? "failed"
          : cli.status === "unavailable" || cli.status === "unsupported"
            ? "unknown"
            : "current",
  }
}

export function normalizeCliCheckUpdateResult(stdout: string, currentVersion?: string): SkillCliVersionCheck {
  const command = createCliCheckUpdateArgs()
  const raw = stdout.trim()
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("CLI update check returned an unsupported response.")
  }

  const result = parsed as RawCliCheckUpdateResult
  const resultCurrentVersion = asText(result.currentVersion) ?? currentVersion
  const latestVersion = asText(result.latestVersion)
  const message = asText(result.message)

  if (result.status === "update-available" && resultCurrentVersion && latestVersion) {
    return {
      command,
      currentVersion: resultCurrentVersion,
      latestVersion,
      raw,
      status: "update-available",
    }
  }

  if (result.status === "up-to-date") {
    return {
      command,
      currentVersion: resultCurrentVersion,
      latestVersion,
      raw,
      status: "up-to-date",
    }
  }

  if (result.status === "failed") {
    return {
      command,
      currentVersion: resultCurrentVersion,
      error: message,
      raw,
      status: "failed",
    }
  }

  throw new Error("CLI update check returned an unsupported status.")
}

function normalizeSkillSearchResult(value: unknown): SkillSearchResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawSkillSearchResult
  const skillId = asText(raw.name)
  const packageName = asText(raw.packageName)

  if (!skillId || !packageName) {
    return undefined
  }

  return {
    description: asText(raw.description),
    displayName: asText(raw.skillDisplayName) ?? skillId,
    id: `${packageName}:${skillId}`,
    packageName,
    skillId,
    version: asText(raw.packageVersion),
  }
}

function normalizeMyPublishedPackage(value: unknown): NormalizedMyPublishedPackage | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawMyPublishedPackageListItem
  const name = asText(raw.name)

  if (!name) {
    return undefined
  }

  return {
    description: asText(raw.description),
    displayName: asText(raw.displayName) ?? name,
    icon: asText(raw.icon),
    name,
    updateTime: typeof raw.updateTime === "number" && Number.isFinite(raw.updateTime) ? raw.updateTime : undefined,
    version: asText(raw.version) ?? "latest",
    visibility: readPackageVisibility(raw),
  }
}

function normalizeRegistryPackageSkill(value: unknown): RegistryPackageSkillInfo["skills"][number] | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawRegistryPackageSkill
  const name = asText(raw.name)

  if (!name) {
    return undefined
  }

  return {
    description: asText(raw.description),
    displayName: asText(raw.title) ?? name,
    name,
  }
}

export function createInstallRegistrySkillArgs(request: {
  force?: boolean
  packageName: string
  skillId: string
}): string[] {
  const packageName = asRequiredCommandValue(request.packageName, "packageName")
  const skillId = asRequiredCommandValue(request.skillId, "skillId")
  const args = ["skills", "install", packageName, "--skill", skillId]

  if (request.force) {
    args.push("--force")
  }

  args.push("--json")
  return args
}

export function createUpdateRegistrySkillArgs(request: { packageName?: string; skillId?: string }): string[] {
  const args = ["skills", "update"]
  const packageName = request.packageName?.trim()

  if (packageName) {
    args.push(asRequiredCommandValue(packageName, "packageName"))
  }

  if (request.skillId !== undefined) {
    args.push("--skill", asRequiredCommandValue(request.skillId, "skillId"))
  }

  args.push("--json")
  return args
}

export function createPublishSkillArgs(request: { path: string; visibility?: "private" | "public" }): string[] {
  const args = ["skills", "publish", asRequiredCommandValue(request.path, "path"), "-y"]

  if (request.visibility) {
    args.push("--visibility", request.visibility)
  }

  return args
}

export function createAdoptLocalSkillArgs(request: {
  agent?: string
  description?: string
  icon?: string
  name?: string
  path: string
  title?: string
}): string[] {
  const args = ["skills", "adopt", asRequiredCommandValue(request.path, "path")]

  if (request.agent) {
    args.push("--agent", asRequiredCommandValue(request.agent, "agent"))
  }

  if (request.name) {
    args.push("--name", asRequiredCommandValue(request.name, "name"))
  }

  if (request.description) {
    args.push("--description", asRequiredCommandValue(request.description, "description"))
  }

  if (request.icon) {
    args.push("--icon", asRequiredCommandValue(request.icon, "icon"))
  }

  if (request.title) {
    args.push("--title", asRequiredCommandValue(request.title, "title"))
  }

  return args
}

export function createShareSkillArgs(request: ShareSkillRequest): string[] {
  const skillReference =
    request.sourcePath === undefined
      ? asRequiredCommandValue(request.skillId, "skillId")
      : asRequiredCommandValue(request.sourcePath, "sourcePath")
  const args = request.language ? ["--lang", validateShareLanguage(request.language)] : []

  args.push("skills", "share", skillReference, "-y")

  if (request.days !== undefined) {
    args.push("--days", String(validateShareDays(request.days)))
  }

  if (request.downloads !== undefined) {
    args.push("--downloads", String(validateShareDownloads(request.downloads)))
  }

  return args
}

export function normalizeSkillShareInfo(stdout: string): SkillShareInfo {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Package info returned an unsupported response.")
  }

  const raw = parsed as RawPackageInfoResponse
  const access = readPackageAccess(raw)
  const packageName = asText(raw.packageName)
  const visibility = access === "private" || access === "restricted" ? "private" : "public"

  return {
    limitsRequired: visibility === "private",
    packageName,
    visibility,
  }
}

export function normalizeRegistryPackageVersionInfo(stdout: string): RegistryPackageVersionInfo {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Package info returned an unsupported response.")
  }

  const raw = parsed as RawPackageInfoResponse
  const latestVersion = asText(raw.packageVersion) ?? asText(raw.version)

  if (!latestVersion) {
    throw new Error("Package info returned an unsupported response.")
  }

  return {
    latestVersion,
    packageName: asText(raw.packageName),
  }
}

export function normalizeRegistryPackageSkillInfo(stdout: string): RegistryPackageSkillInfo {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Package info returned an unsupported response.")
  }

  const raw = parsed as RawPackageInfoResponse
  const packageName = asText(raw.packageName) ?? asText(raw.name)
  const packageVersion = asText(raw.packageVersion) ?? asText(raw.version)

  if (!packageName || !packageVersion) {
    throw new Error("Package info returned an unsupported response.")
  }

  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .map(normalizeRegistryPackageSkill)
        .filter((skill): skill is RegistryPackageSkillInfo["skills"][number] => Boolean(skill))
    : []

  return {
    description: asText(raw.description),
    displayName: asText(raw.title) ?? asText(raw.displayName) ?? packageName,
    icon: asText(raw.icon),
    packageName,
    packageVersion,
    skills,
    visibility: readPackageVisibility(raw),
  }
}

function readPackageAccess(raw: RawPackageInfoResponse): "private" | "public" | "restricted" | undefined {
  if (typeof raw.isPrivate === "boolean") {
    return raw.isPrivate ? "private" : "public"
  }

  const access = asText(raw.access) ?? asText(raw.visibility)
  if (access === "private" || access === "public" || access === "restricted") {
    return access
  }

  return undefined
}

function readPackageVisibility(
  raw: Pick<RawPackageInfoResponse, "access" | "isPrivate" | "visibility">,
): MyPublishedSkill["visibility"] {
  const access = readPackageAccess(raw)

  if (access === "private" || access === "restricted") {
    return "private"
  }

  if (access === "public") {
    return "public"
  }

  return "unknown"
}

export function normalizeSkillShareResult(stdout: string): SkillShareResult {
  const prompt = sanitizeSkillInstallCommands(extractSkillSharePrompt(stdout))
  const installCommandMatch = prompt.match(/oo skills install[^\r\n`]+/)

  return {
    installCommand: installCommandMatch?.[0]?.trim(),
    prompt,
  }
}

function extractSkillSharePrompt(stdout: string): string {
  const trimmed = stdout.trim()
  const textBlockMatch = trimmed.match(/```(?:text)?[ \t]*\r?\n([\s\S]*?)\r?\n```/)

  return (textBlockMatch?.[1] ?? trimmed).trim()
}

function sanitizeSkillInstallCommands(prompt: string): string {
  return prompt.replace(/oo skills install[^\r\n`]+/g, (command) => sanitizeSkillInstallCommand(command))
}

function sanitizeSkillInstallCommand(command: string): string {
  return command
    .replace(/(^|\s)(?:-y|--yes)(?=\s|$)/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function createDeleteSkillArgs(request: { agentId?: string; skillId: string }): string[] {
  const skillId = asRequiredCommandValue(request.skillId, "skillId")

  if (builtInSkillIds.includes(skillId as BuiltInSkillId)) {
    throw new Error("Built-in Skills cannot be deleted.")
  }

  const args = ["skills", "uninstall", skillId, "--json"]

  if (request.agentId) {
    args.push("--agent", request.agentId)
  }

  return args
}

export function assertSkillOperationSucceeded(stdout: string, expectedCommand: SkillOperationCommand): void {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Skill operation returned an unsupported response.")
  }

  const result = parsed as RawSkillOperationResult

  if (result.command !== expectedCommand) {
    throw new Error("Skill operation returned an unexpected command response.")
  }

  if (!isSkillOperationStatus(result.status)) {
    throw new Error("Skill operation returned an unsupported status.")
  }

  if (result.status === "failed" || result.status === "partial-failure") {
    throw new Error(createSkillOperationErrorMessage(result))
  }
}

function isSkillOperationStatus(status: unknown): status is SkillOperationStatus {
  return status === "completed" || status === "failed" || status === "noop" || status === "partial-failure"
}

function createSkillOperationErrorMessage(result: RawSkillOperationResult): string {
  const messages = collectSkillOperationErrorMessages(result)

  return messages[0] ?? "Skill operation failed."
}

function collectSkillOperationErrorMessages(result: RawSkillOperationResult): string[] {
  const messages: string[] = []

  collectSkillOperationErrorList(messages, result.errors)
  collectSkillOperationEntryErrorList(messages, result.skills)
  collectSkillOperationEntryErrorList(messages, result.records)

  return messages
}

function collectSkillOperationErrorList(messages: string[], errors: unknown): void {
  if (!Array.isArray(errors)) {
    return
  }

  for (const error of errors) {
    const message = readSkillOperationErrorMessage(error)
    if (message) {
      messages.push(message)
    }
  }
}

function collectSkillOperationEntryErrorList(messages: string[], entries: unknown): void {
  if (!Array.isArray(entries)) {
    return
  }

  const visited = new Set<object>()
  const stack = entries.map((entry) => ({ depth: 0, entry })).reverse()

  while (stack.length > 0) {
    const { depth, entry } = stack.pop()!
    if (!entry || typeof entry !== "object") {
      continue
    }

    if (visited.has(entry)) {
      continue
    }
    visited.add(entry)

    const rawEntry = entry as RawSkillOperationEntry
    const message = readSkillOperationErrorMessage(rawEntry.error)
    if (message) {
      messages.push(message)
    }

    if (depth >= skillOperationEntryErrorMaxDepth || !Array.isArray(rawEntry.targets)) {
      continue
    }

    for (let index = rawEntry.targets.length - 1; index >= 0; index -= 1) {
      stack.push({ depth: depth + 1, entry: rawEntry.targets[index] })
    }
  }
}

function readSkillOperationErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined
  }

  const raw = error as RawSkillOperationError
  return asText(raw.message) ?? asText(raw.code)
}

function createRegistrySkillCheckUpdateErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined
  }

  return asText((error as RawRegistrySkillCheckUpdateError).message)
}

function comparePackageVersions(left: string, right: string): number | undefined {
  const leftSemver = parseSemver(left)
  const rightSemver = parseSemver(right)

  if (!leftSemver || !rightSemver) {
    return undefined
  }

  if (leftSemver.major !== rightSemver.major) {
    return leftSemver.major - rightSemver.major
  }

  if (leftSemver.minor !== rightSemver.minor) {
    return leftSemver.minor - rightSemver.minor
  }

  if (leftSemver.patch !== rightSemver.patch) {
    return leftSemver.patch - rightSemver.patch
  }

  return comparePrerelease(leftSemver.prerelease, rightSemver.prerelease)
}

function parseSemver(version: string):
  | {
      major: number
      minor: number
      patch: number
      prerelease: string[]
    }
  | undefined {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version.trim(),
    )

  if (!match) {
    return undefined
  }

  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
    prerelease: match[4]?.split(".") ?? [],
  }
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0
  }

  if (left.length === 0) {
    return 1
  }

  if (right.length === 0) {
    return -1
  }

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]

    if (leftPart === undefined) {
      return -1
    }

    if (rightPart === undefined) {
      return 1
    }

    if (leftPart === rightPart) {
      continue
    }

    const leftNumber = /^\d+$/.test(leftPart) ? Number.parseInt(leftPart, 10) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number.parseInt(rightPart, 10) : undefined

    if (leftNumber !== undefined && rightNumber !== undefined) {
      return leftNumber - rightNumber
    }

    if (leftNumber !== undefined) {
      return -1
    }

    if (rightNumber !== undefined) {
      return 1
    }

    return leftPart.localeCompare(rightPart)
  }

  return 0
}

function asRequiredCommandValue(value: string, fieldName: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${fieldName} is required.`)
  }

  return trimmed
}

function validateShareLanguage(language: ShareSkillRequest["language"]): "en" | "zh" {
  if (language !== "en" && language !== "zh") {
    throw new Error("language must be en or zh.")
  }

  return language
}

function validateShareDays(days: number): number {
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error("days must be an integer from 1 to 7.")
  }

  return days
}

function validateShareDownloads(downloads: number): number {
  if (!Number.isInteger(downloads) || downloads < 1) {
    throw new Error("downloads must be a positive integer.")
  }

  return downloads
}
