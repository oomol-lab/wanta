import type { SupportedAgent } from "../agents/catalog.ts"
import type { LocalSkillProject } from "./common.ts"
import type { InstalledSkill, ManagedSkillMetadata } from "./types.ts"
import type { Dirent } from "node:fs"

import { load as parseYaml } from "js-yaml"
import { access, readdir, readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { listDiscoveredAgents, resolveAgentHomeRoot, resolveAgentSkillRoot } from "../agents/catalog.ts"
import { logDiagnosticOnChange } from "../diagnostics-log.ts"
import { metadataFileName, skippedDirectoryNames } from "./constants.ts"
import { hashTextFiles } from "./hash.ts"
import { normalizeMetadata } from "./metadata.ts"
import { resolveCanonicalSourcePath } from "./paths.ts"

const externalSkillLockFileName = ".skill-lock.json"
const lumoRuntimeAgent: SupportedAgent = {
  cliCommands: [],
  homeRoot: "",
  id: "lumo",
  name: "Lumo",
  ooCliAgentId: "lumo",
}

interface SkillRootScanTarget {
  agent: SupportedAgent
  canonicalSourceRoot?: string
  resolveSourcePath?: (skill: {
    metadata: ManagedSkillMetadata
    name: string
    path: string
  }) => Promise<string> | string
  skillRoot: string
}

async function readSkillEntries(skillRoot: string): Promise<Dirent[]> {
  try {
    return await readdir(skillRoot, { withFileTypes: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isMissing = message.includes("ENOENT")
    logDiagnosticOnChange(
      `skill-scan:root:${skillRoot}`,
      "skill-scan",
      "failed to read skill root",
      { error: message, skillRoot },
      isMissing ? "trace" : "warn",
      isMissing ? { missing: true, skillRoot } : { error: message, skillRoot },
    )
    return []
  }
}

export async function scanInstalledSkills(agents?: readonly SupportedAgent[]): Promise<InstalledSkill[]> {
  const targetAgents = agents ?? (await listDiscoveredAgents())
  logDiagnosticOnChange("skill-scan:installed:start", "skill-scan", "starting installed skill scan", {
    agentIds: targetAgents.map((agent) => agent.id),
  })
  const perAgentSkills = await Promise.all(
    targetAgents.map((agent) => {
      return scanInstalledSkillRoot({ agent, skillRoot: resolveAgentSkillRoot(agent) })
    }),
  )

  const installedSkills = perAgentSkills.flat()
  logDiagnosticOnChange("skill-scan:installed:completed", "skill-scan", "completed installed skill scan", {
    installedCount: installedSkills.length,
  })
  return installedSkills
}

export async function scanLumoInstalledSkills(request: {
  cacheSkillStoreRoot: string
  sharedSkillRoot: string
}): Promise<InstalledSkill[]> {
  return scanInstalledSkillRoot({
    agent: lumoRuntimeAgent,
    resolveSourcePath: (skill) => resolveLumoSkillSourcePath(skill, request.cacheSkillStoreRoot),
    skillRoot: request.sharedSkillRoot,
  })
}

async function scanInstalledSkillRoot(target: SkillRootScanTarget): Promise<InstalledSkill[]> {
  const { agent, canonicalSourceRoot, skillRoot } = target
  const entries = await readSkillEntries(skillRoot)
  let candidateCount = 0
  let hiddenCount = 0
  let installedCount = 0
  const skills = await Promise.all(
    entries.map(async (entry): Promise<InstalledSkill | undefined> => {
      if (shouldSkipSkillRootEntry(entry) || (!entry.isDirectory() && !entry.isSymbolicLink())) {
        return undefined
      }

      candidateCount += 1
      const skillPath = path.join(skillRoot, entry.name)
      const metadataPath = path.join(skillPath, metadataFileName)

      try {
        const metadataContent = await readInstalledMetadataContent(metadataPath)
        const frontmatterMetadata = await readSkillFrontmatterMetadata(skillPath, entry.name)

        if (!metadataContent && !frontmatterMetadata.validSkillFile) {
          throw new Error(`${metadataFileName} missing and SKILL.md unavailable`)
        }

        const normalizedMetadata = metadataContent
          ? normalizeMetadata(metadataContent, entry.name)
          : ({
              kind: "local",
            } satisfies ManagedSkillMetadata)
        const metadata = {
          ...normalizedMetadata,
          description: frontmatterMetadata.description ?? normalizedMetadata.description,
          icon: normalizedMetadata.icon ?? frontmatterMetadata.icon,
          packageName: normalizedMetadata.packageName ?? frontmatterMetadata.packageName,
          version: normalizedMetadata.version ?? frontmatterMetadata.version,
        }
        const sourcePath = target.resolveSourcePath
          ? await target.resolveSourcePath({
              metadata,
              name: entry.name,
              path: skillPath,
            })
          : canonicalSourceRoot
            ? path.join(canonicalSourceRoot, entry.name)
            : resolveCanonicalSourcePath({
                agent,
                metadata,
                name: entry.name,
                path: skillPath,
              })
        const [hash, sourceHash] = await Promise.all([hashTextFiles(skillPath), hashTextFiles(sourcePath)])

        return {
          agent,
          hash: hash ?? "",
          metadata,
          name: entry.name,
          path: skillPath,
          sourceHash,
          sourcePath,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isMissingSkillDefinition = message.includes(`${metadataFileName} missing and SKILL.md unavailable`)
        hiddenCount += 1
        logDiagnosticOnChange(
          `skill-scan:installed-candidate:${skillPath}`,
          "skill-scan",
          "installed skill candidate hidden",
          {
            agentId: agent.id,
            error: message,
            skillName: entry.name,
            skillPath,
          },
          isMissingSkillDefinition ? "trace" : "warn",
          isMissingSkillDefinition
            ? { agentId: agent.id, skillDefinitionMissing: true, skillName: entry.name, skillPath }
            : { agentId: agent.id, error: message, skillName: entry.name, skillPath },
        )
        return undefined
      }
    }),
  )

  const installedSkills = skills.filter((skill): skill is InstalledSkill => Boolean(skill))
  installedCount = installedSkills.length
  logDiagnosticOnChange(`skill-scan:installed-root:${skillRoot}`, "skill-scan", "completed installed skill root scan", {
    agentId: agent.id,
    candidateCount,
    entryCount: entries.length,
    hiddenCount,
    installedCount,
    skillRoot,
  })
  return installedSkills
}

async function resolveLumoSkillSourcePath(
  skill: { metadata: ManagedSkillMetadata; name: string; path: string },
  cacheSkillStoreRoot: string,
): Promise<string> {
  const sourceCandidates = readLumoSkillSourceCandidates(skill, cacheSkillStoreRoot)

  for (const candidate of sourceCandidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return path.resolve(skill.path)
}

function readLumoSkillSourceCandidates(
  skill: { metadata: ManagedSkillMetadata; name: string },
  cacheSkillStoreRoot: string,
): string[] {
  if (skill.name.includes("/") || skill.name.includes("\\") || skill.name === "." || skill.name === "..") {
    throw new Error(`Invalid skill name: ${skill.name}`)
  }

  if (skill.metadata.kind === "registry") {
    return [path.join(cacheSkillStoreRoot, "registry", skill.name)]
  }

  if (skill.metadata.kind === "bundled") {
    return [
      path.join(cacheSkillStoreRoot, "bundled", "lumo", skill.name),
      path.join(cacheSkillStoreRoot, "bundled", "universal", skill.name),
    ]
  }

  return []
}

export async function scanLocalSkillProjects(agents?: readonly SupportedAgent[]): Promise<LocalSkillProject[]> {
  const targetAgents = agents ?? (await listDiscoveredAgents())
  logDiagnosticOnChange("skill-scan:local:start", "skill-scan", "starting local project scan", {
    agentIds: targetAgents.map((agent) => agent.id),
  })
  const perAgentProjects = await Promise.all(
    targetAgents.map(async (agent): Promise<LocalSkillProject[]> => {
      const skillRoot = resolveAgentSkillRoot(agent)
      const [entries, externalManagedRoots] = await Promise.all([
        readSkillEntries(skillRoot),
        readExternalManagedSkillRoots(agent),
      ])
      let candidateCount = 0
      let externalManagedCount = 0
      let managedMetadataCount = 0
      let skippedCount = 0
      const projects = await Promise.all(
        entries.map(async (entry): Promise<LocalSkillProject | undefined> => {
          if (shouldSkipSkillRootEntry(entry) || (!entry.isDirectory() && !entry.isSymbolicLink())) {
            skippedCount += 1
            return undefined
          }

          candidateCount += 1
          const skillPath = path.join(skillRoot, entry.name)

          if (await isExternalManagedSkillRoot(skillPath, externalManagedRoots)) {
            externalManagedCount += 1
            return undefined
          }

          if (await pathExists(path.join(skillPath, metadataFileName))) {
            managedMetadataCount += 1
            return undefined
          }

          return readLocalSkillProject(agent, skillPath, entry.name)
        }),
      )

      const localProjects = projects.filter((project): project is LocalSkillProject => Boolean(project))
      logDiagnosticOnChange(`skill-scan:local-root:${skillRoot}`, "skill-scan", "completed local project root scan", {
        agentId: agent.id,
        candidateCount,
        entryCount: entries.length,
        externalManagedCount,
        localProjectCount: localProjects.length,
        managedMetadataCount,
        skippedCount,
        skillRoot,
      })
      return localProjects
    }),
  )

  const localProjects = perAgentProjects
    .flat()
    .sort((left, right) => left.name.localeCompare(right.name) || left.agentName.localeCompare(right.agentName))
  logDiagnosticOnChange("skill-scan:local:completed", "skill-scan", "completed local project scan", {
    localProjectCount: localProjects.length,
  })
  return localProjects
}

async function readExternalManagedSkillRoots(agent: SupportedAgent): Promise<Set<string>> {
  const lockRoot = resolveAgentHomeRoot(agent)
  const lockPath = path.join(lockRoot, externalSkillLockFileName)
  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"))
  } catch (error) {
    logDiagnosticOnChange(
      `skill-scan:external-lock:${lockPath}`,
      "skill-scan",
      "external skill lock unavailable",
      {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
        lockPath,
      },
      "trace",
      { agentId: agent.id, lockPath, status: "unavailable" },
    )
    return new Set()
  }

  if (!isRecord(parsed) || !isRecord(parsed["skills"])) {
    logDiagnosticOnChange(
      `skill-scan:external-lock:${lockPath}`,
      "skill-scan",
      "external skill lock malformed",
      { agentId: agent.id, lockPath },
      "warn",
    )
    return new Set()
  }

  const roots = new Set<string>()
  const identities = await Promise.all(
    Object.values(parsed["skills"]).map(async (entry) => {
      if (!isRecord(entry)) {
        return []
      }

      const skillPath = readFrontmatterString(entry, "skillPath")
      if (!skillPath) {
        return []
      }

      const absolutePath = path.resolve(lockRoot, skillPath)
      const skillRoot =
        path.basename(absolutePath).toLowerCase() === "skill.md" ? path.dirname(absolutePath) : absolutePath
      return readPathIdentities(skillRoot)
    }),
  )

  for (const identity of identities.flat()) {
    roots.add(identity)
  }

  logDiagnosticOnChange(`skill-scan:external-lock:${lockPath}`, "skill-scan", "external skill lock loaded", {
    agentId: agent.id,
    lockPath,
    managedRootCount: roots.size,
  })
  return roots
}

async function isExternalManagedSkillRoot(
  skillPath: string,
  externalManagedRoots: ReadonlySet<string>,
): Promise<boolean> {
  if (externalManagedRoots.size === 0) {
    return false
  }

  const identities = await readPathIdentities(skillPath)
  return identities.some((identity) => externalManagedRoots.has(identity))
}

async function readPathIdentities(pathname: string): Promise<string[]> {
  const identities = [normalizePathIdentity(pathname)]

  try {
    identities.push(normalizePathIdentity(await realpath(pathname)))
  } catch {
    // 外部 lock 只用于识别 ownership，路径不可解析时不影响 OOMOL 主扫描。
  }

  return Array.from(new Set(identities))
}

function normalizePathIdentity(pathname: string): string {
  const normalized = path.normalize(path.resolve(pathname))
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

async function readLocalSkillProject(
  agent: SupportedAgent,
  skillPath: string,
  skillName: string,
): Promise<LocalSkillProject | undefined> {
  let content: string

  try {
    content = await readFile(path.join(skillPath, "SKILL.md"), "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isMissing = message.includes("ENOENT")
    logDiagnosticOnChange(
      `skill-scan:local-project:${skillPath}`,
      "skill-scan",
      "local project missing SKILL.md",
      { agentId: agent.id, error: message, skillName, skillPath },
      isMissing ? "trace" : "warn",
      isMissing
        ? { agentId: agent.id, missing: true, skillName, skillPath }
        : { agentId: agent.id, error: message, skillName, skillPath },
    )
    return undefined
  }

  const frontmatter = parseSkillFrontmatter(content)

  if (!frontmatter) {
    logDiagnosticOnChange(
      `skill-scan:local-project:${skillPath}`,
      "skill-scan",
      "local project frontmatter unavailable",
      { agentId: agent.id, skillName, skillPath },
      "warn",
    )
    return undefined
  }

  const name = readFrontmatterString(frontmatter, "name")
  const description = readFrontmatterString(frontmatter, "description")
  const metadata = isRecord(frontmatter["metadata"]) ? frontmatter["metadata"] : undefined

  if (name !== skillName || !description) {
    logDiagnosticOnChange(
      `skill-scan:local-project:${skillPath}`,
      "skill-scan",
      "local project metadata incomplete",
      {
        agentId: agent.id,
        hasDescription: Boolean(description),
        nameMatchesDirectory: name === skillName,
        skillName,
        skillPath,
      },
      "warn",
    )
    return undefined
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    description,
    icon: readSkillFrontmatterIcon(frontmatter),
    id: `${agent.id}:${skillName}`,
    name: skillName,
    packageName: metadata ? readFrontmatterString(metadata, "packageName") : undefined,
    path: skillPath,
    version: metadata ? readFrontmatterString(metadata, "version") : undefined,
  }
}

function shouldSkipSkillRootEntry(entry: Dirent): boolean {
  return entry.name.startsWith(".") || skippedDirectoryNames.has(entry.name) || isBackupSkillDirectoryName(entry.name)
}

function isBackupSkillDirectoryName(name: string): boolean {
  return /\.backup(?:[.-]\d{8}-\d{6})?$/.test(name) || /\.backup[.-]/.test(name)
}

async function readInstalledMetadataContent(metadataPath: string): Promise<string | undefined> {
  try {
    return await readFile(metadataPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("ENOENT") && message.includes(metadataFileName)) {
      return undefined
    }

    throw error
  }
}

interface SkillFrontmatterMetadata extends Pick<
  ManagedSkillMetadata,
  "description" | "icon" | "packageName" | "version"
> {
  validSkillFile: boolean
}

async function readSkillFrontmatterMetadata(skillPath: string, skillName: string): Promise<SkillFrontmatterMetadata> {
  let content: string

  try {
    content = await readFile(path.join(skillPath, "SKILL.md"), "utf8")
  } catch {
    return { validSkillFile: false }
  }

  const frontmatter = parseSkillFrontmatter(content)
  const name = readFrontmatterString(frontmatter, "name")

  if (name && name !== skillName) {
    return { validSkillFile: false }
  }

  const metadata = isRecord(frontmatter?.["metadata"]) ? frontmatter["metadata"] : undefined

  return {
    description: readFrontmatterString(frontmatter, "description"),
    icon: readSkillFrontmatterIcon(frontmatter),
    packageName: readFrontmatterString(metadata, "packageName"),
    validSkillFile: Boolean(frontmatter),
    version: readFrontmatterString(metadata, "version"),
  }
}

function readSkillFrontmatterIcon(frontmatter: unknown): string | undefined {
  const metadata = isRecord(frontmatter) && isRecord(frontmatter["metadata"]) ? frontmatter["metadata"] : undefined

  return readFrontmatterString(frontmatter, "icon") ?? readFrontmatterString(metadata, "icon")
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

function readFrontmatterString(record: unknown, key: string): string | undefined {
  if (!isRecord(record)) {
    return undefined
  }

  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseSkillFrontmatter(content: string): Record<string, unknown> | undefined {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return undefined
  }

  const bodyStart = content.startsWith("---\r\n") ? 5 : 4
  const endMatch = /\r?\n---(?:\r?\n|$)/.exec(content.slice(bodyStart))

  if (!endMatch) {
    return undefined
  }

  const yamlContent = content.slice(bodyStart, bodyStart + endMatch.index)

  try {
    const parsed = parseYaml(yamlContent)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
