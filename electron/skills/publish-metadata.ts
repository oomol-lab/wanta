import { dump as dumpYaml, load as parseYaml } from "js-yaml"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

interface SkillFrontmatterRange {
  afterClosingDelimiter: number
  bodyStart: number
  eol: "\n" | "\r\n"
  yamlEnd: number
}

export interface EnsureSkillPublishMetadataResult {
  packageName: string
  updated: boolean
  version: string
}

const defaultPublishVersion = "0.0.1"

export async function ensureSkillPublishMetadata(request: {
  accountName?: string
  packageScope?: string
  skillPath: string
}): Promise<EnsureSkillPublishMetadataResult> {
  const skillFilePath = path.join(request.skillPath, "SKILL.md")
  const content = await readFile(skillFilePath, "utf8")
  const next = ensureSkillPublishMetadataContent(content, {
    accountName: request.accountName,
    fallbackSkillName: path.basename(request.skillPath),
    packageScope: request.packageScope,
  })

  if (next.updated) {
    await writeFile(skillFilePath, next.content, "utf8")
  }

  return {
    packageName: next.packageName,
    updated: next.updated,
    version: next.version,
  }
}

export function ensureSkillPublishMetadataContent(
  content: string,
  request: { accountName?: string; fallbackSkillName: string; packageScope?: string },
): EnsureSkillPublishMetadataResult & { content: string } {
  const range = readFrontmatterRange(content)
  if (!range) {
    throw new Error("Skill publishing requires SKILL.md frontmatter.")
  }

  const frontmatter = readFrontmatter(content.slice(range.bodyStart, range.yamlEnd))
  const skillName = asText(frontmatter["name"]) ?? request.fallbackSkillName
  const metadata = isRecord(frontmatter["metadata"]) ? { ...frontmatter["metadata"] } : {}
  const packageName = resolvePublishPackageName(
    asText(metadata["packageName"]),
    request.packageScope ?? request.accountName,
    skillName,
  )
  const version = asText(metadata["version"]) ?? defaultPublishVersion

  if (metadata["packageName"] === packageName && metadata["version"] === version && isRecord(frontmatter["metadata"])) {
    return { content, packageName, updated: false, version }
  }

  metadata["packageName"] = packageName
  metadata["version"] = version
  frontmatter["metadata"] = metadata

  const nextYaml = dumpYaml(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd()
  const body = content.slice(range.afterClosingDelimiter)
  const nextContent = `---${range.eol}${nextYaml}${range.eol}---${range.eol}${body}`

  return {
    content: nextContent,
    packageName,
    updated: true,
    version,
  }
}

export function createDefaultSkillPackageName(accountName: string | undefined, skillName: string): string {
  const scope = normalizePackageNamePart(accountName)
  if (!scope) {
    throw new Error("Skill publishing requires a signed-in account name to create a packageName.")
  }

  const name = normalizePackageNamePart(skillName)
  if (!name) {
    throw new Error("Skill publishing requires a valid Skill name to create a packageName.")
  }

  return `@${scope}/${name}`
}

function resolvePublishPackageName(
  existingPackageName: string | undefined,
  accountName: string | undefined,
  skillName: string,
): string {
  if (!existingPackageName) {
    return createDefaultSkillPackageName(accountName, skillName)
  }

  const accountScope = normalizePackageNamePart(accountName)
  if (!accountScope) {
    return existingPackageName
  }

  const packageName = existingPackageName.trim()
  const current = readScopedPackageName(packageName)
  if (current?.scope === accountScope) {
    return packageName
  }

  const name = normalizePackageNamePart(current?.name ?? packageName)
  if (!name) {
    return createDefaultSkillPackageName(accountName, skillName)
  }

  return `@${accountScope}/${name}`
}

function readScopedPackageName(packageName: string): { name: string; scope: string } | undefined {
  const match = /^@([^/]+)\/(.+)$/.exec(packageName.trim())
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const scope = normalizePackageNamePart(match[1])
  const name = normalizePackageNamePart(match[2])
  if (!scope || !name) {
    return undefined
  }

  return { name, scope }
}

function readFrontmatterRange(content: string): SkillFrontmatterRange | undefined {
  const eol = content.startsWith("---\r\n") ? "\r\n" : content.startsWith("---\n") ? "\n" : undefined
  if (!eol) {
    return undefined
  }

  const bodyStart = 3 + eol.length
  const endPattern = eol === "\r\n" ? /\r\n---(?:\r\n|$)/ : /\n---(?:\n|$)/
  const endMatch = endPattern.exec(content.slice(bodyStart))
  if (!endMatch) {
    return undefined
  }

  return {
    afterClosingDelimiter: bodyStart + endMatch.index + endMatch[0].length,
    bodyStart,
    eol,
    yamlEnd: bodyStart + endMatch.index,
  }
}

function readFrontmatter(yamlContent: string): Record<string, unknown> {
  const parsed = parseYaml(yamlContent)
  if (!isRecord(parsed)) {
    throw new Error("Skill publishing requires valid SKILL.md frontmatter.")
  }
  return { ...parsed }
}

function normalizePackageNamePart(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
