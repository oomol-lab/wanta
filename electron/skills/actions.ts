import type {
  BuiltInSkillId,
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  PublicSkillPackageMaintainer,
  PublicSkillPackageSkill,
  SkillCliVersionCheck,
  SkillPackageVersionCheck,
  SkillSearchResult,
} from "./common.ts"

import { builtInSkillIds } from "./constants.ts"

type SkillOperationCommand = "skills.install" | "skills.publish" | "skills.uninstall" | "skills.update"

type SkillOperationStatus = "completed" | "failed" | "noop" | "partial-failure"

interface RawSkillSearchResult {
  description?: unknown
  name?: unknown
  packageName?: unknown
  packageVersion?: unknown
  skillDisplayName?: unknown
}

interface RawPublicSkillPackageListResponse {
  data?: unknown
  next?: unknown
}

interface RawPublicSkillPackageListItem {
  description?: unknown
  displayName?: unknown
  downloadCount?: unknown
  extra?: unknown
  icon?: unknown
  isTemplate?: unknown
  maintainerIds?: unknown
  name?: unknown
  skills?: unknown
  updateTime?: unknown
  version?: unknown
  visibility?: unknown
}

interface RawPublicSkillPackageSkill {
  description?: unknown
  name?: unknown
  title?: unknown
}

interface RawPublicSkillPackageMaintainer {
  id?: unknown
  name?: unknown
  url?: unknown
}

interface RawPublicSkillPackageExtra {
  maintainers?: unknown
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

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
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

export function normalizeSkillSearchResults(stdout: string): SkillSearchResult[] {
  const parsed = JSON.parse(stdout) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error("Skill search returned an unsupported response.")
  }

  return parsed.map(normalizeSkillSearchResult).filter((result): result is SkillSearchResult => Boolean(result))
}

export function normalizePublicSkillPackageCatalog(
  stdout: string,
  updatedAt = new Date().toISOString(),
): PublicSkillPackageCatalog {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Public Skill package list returned an unsupported response.")
  }

  const raw = parsed as RawPublicSkillPackageListResponse
  if (!Array.isArray(raw.data)) {
    throw new Error("Public Skill package list returned an unsupported response.")
  }

  return {
    items: raw.data.map(normalizePublicSkillPackage).filter((item): item is PublicSkillPackage => Boolean(item)),
    next: typeof raw.next === "string" && raw.next.trim() ? raw.next.trim() : null,
    updatedAt,
  }
}

function normalizePublicSkillPackage(value: unknown): PublicSkillPackage | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawPublicSkillPackageListItem
  const name = asText(raw.name)
  if (!name) {
    return undefined
  }

  const version = asText(raw.version) ?? "latest"
  const displayName = asText(raw.displayName) ?? name
  const visibility = asPublicSkillVisibility(raw.visibility)
  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .map(normalizePublicSkillPackageSkill)
        .filter((item): item is PublicSkillPackage["skills"][number] => Boolean(item))
    : []

  return {
    description: asText(raw.description),
    displayName,
    downloadCount: asNumber(raw.downloadCount),
    icon: asText(raw.icon),
    id: `${name}@${version}`,
    isTemplate: raw.isTemplate === true,
    maintainers: normalizePublicSkillPackageMaintainers(raw.extra),
    name,
    skills,
    updateTime: asNumber(raw.updateTime),
    version,
    visibility,
  }
}

function normalizePublicSkillPackageSkill(value: unknown): PublicSkillPackageSkill | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawPublicSkillPackageSkill
  const name = asText(raw.name)
  if (!name) {
    return undefined
  }

  return {
    description: asText(raw.description),
    name,
    title: asText(raw.title) ?? name,
  }
}

function normalizePublicSkillPackageMaintainers(extra: unknown): PublicSkillPackageMaintainer[] {
  if (!extra || typeof extra !== "object") {
    return []
  }

  const maintainers = (extra as RawPublicSkillPackageExtra).maintainers
  if (typeof maintainers !== "string" || !maintainers.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(maintainers) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(normalizePublicSkillPackageMaintainer)
      .filter((item): item is PublicSkillPackageMaintainer => Boolean(item))
  } catch {
    return []
  }
}

function normalizePublicSkillPackageMaintainer(value: unknown): PublicSkillPackageMaintainer | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawPublicSkillPackageMaintainer
  const name = asText(raw.name)
  if (!name) {
    return undefined
  }

  return {
    id: asText(raw.id),
    name,
    url: asText(raw.url),
  }
}

function asPublicSkillVisibility(value: unknown): PublicSkillPackage["visibility"] {
  return value === "private" || value === "public" ? value : "unknown"
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

export function createPublishSkillArgs(request: { path: string; visibility?: "public" }): string[] {
  const args = ["skills", "publish", asRequiredCommandValue(request.path, "path"), "-y"]

  if (request.visibility) {
    args.push("--visibility", request.visibility)
  }

  return args
}

export function createDeleteSkillArgs(request: { skillId: string }): string[] {
  const skillId = asRequiredCommandValue(request.skillId, "skillId")

  if (builtInSkillIds.includes(skillId as BuiltInSkillId)) {
    throw new Error("Built-in Skills cannot be deleted.")
  }

  return ["skills", "uninstall", skillId, "--json"]
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

function asRequiredCommandValue(value: string, fieldName: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${fieldName} is required.`)
  }

  return trimmed
}
