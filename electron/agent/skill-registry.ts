import { access, readFile, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"

const MAX_SKILL_FILE_BYTES = 512 * 1024

export interface SkillRegistryEntry {
  description?: string
  id: string
  name: string
  root: string
  source: { id: string; kind: SkillSourceKind }
}

export type SkillSourceKind = "bundled" | "connection" | "managed" | "plugin" | "team" | "user"

export interface SkillRegistrySource {
  id: string
  kind: SkillSourceKind
  root: string
}

export interface SkillDiagnostic {
  code: "duplicate_id" | "embedded_secret" | "hardcoded_agent_path" | "hardcoded_workspace" | "missing_reference"
  severity: "error" | "warning"
  skillId: string
  sourceId: string
  path?: string
}

export interface SkillRegistrySnapshot {
  createdAt: number
  diagnostics: readonly SkillDiagnostic[]
  entries: ReadonlyMap<string, SkillRegistryEntry>
}

/** Wanta-owned discovery for every agent runtime. Earlier roots take precedence. */
export class SkillRegistry {
  private readonly sources: readonly SkillRegistrySource[]

  public constructor(sources: readonly (SkillRegistrySource | string)[]) {
    const normalized = sources.map(
      (source, index): SkillRegistrySource =>
        typeof source === "string"
          ? { id: `legacy-${index}`, kind: "managed", root: path.resolve(source) }
          : { ...source, root: path.resolve(source.root) },
    )
    this.sources = normalized.filter(
      (source, index) => normalized.findIndex((candidate) => candidate.root === source.root) === index,
    )
  }

  public async snapshot(): Promise<SkillRegistrySnapshot> {
    const entries = new Map<string, SkillRegistryEntry>()
    const diagnostics: SkillDiagnostic[] = []
    for (const sourceDefinition of this.sources) {
      const { root } = sourceDefinition
      let children
      try {
        children = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!child.isDirectory()) continue
        if (entries.has(child.name)) {
          diagnostics.push({
            code: "duplicate_id",
            severity: "warning",
            skillId: child.name,
            sourceId: sourceDefinition.id,
          })
          continue
        }
        const skillRoot = path.join(root, child.name)
        try {
          const source = await readBoundedFile(path.join(skillRoot, "SKILL.md"))
          const skillDiagnostics = await lintSkill(child.name, sourceDefinition.id, skillRoot, source)
          diagnostics.push(...skillDiagnostics)
          if (skillDiagnostics.some((diagnostic) => diagnostic.severity === "error")) continue
          const metadata = parseFrontmatter(source)
          entries.set(child.name, {
            id: child.name,
            name: metadata.name ?? child.name,
            ...(metadata.description ? { description: metadata.description } : {}),
            root: skillRoot,
            source: { id: sourceDefinition.id, kind: sourceDefinition.kind },
          })
        } catch {
          // A directory is not a skill unless its SKILL.md is readable and bounded.
        }
      }
    }
    return { createdAt: Date.now(), diagnostics, entries }
  }
}

export function listSkillSnapshot(snapshot: SkillRegistrySnapshot): Array<Omit<SkillRegistryEntry, "root">> {
  return [...snapshot.entries.values()].map(({ root: _root, ...entry }) => entry)
}

async function lintSkill(skillId: string, sourceId: string, root: string, source: string): Promise<SkillDiagnostic[]> {
  const diagnostics: SkillDiagnostic[] = []
  const issue = (code: SkillDiagnostic["code"], severity: SkillDiagnostic["severity"], relativePath?: string): void => {
    diagnostics.push({ code, severity, skillId, sourceId, ...(relativePath ? { path: relativePath } : {}) })
  }
  if (
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{16,}/iu.test(source)
  ) {
    issue("embedded_secret", "error", "SKILL.md")
  }
  if (/(?:\.opencode\/|@opencode-ai\/plugin|\.claude\/|\.codex\/)/u.test(source)) {
    issue("hardcoded_agent_path", "warning", "SKILL.md")
  }
  if (/(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/u.test(source)) {
    issue("hardcoded_workspace", "warning", "SKILL.md")
  }
  for (const reference of markdownRelativeReferences(source)) {
    const target = path.resolve(root, reference)
    const relative = path.relative(root, target)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      issue("missing_reference", "warning", reference)
      continue
    }
    try {
      await access(target)
    } catch {
      issue("missing_reference", "warning", reference)
    }
  }
  return diagnostics
}

function markdownRelativeReferences(source: string): string[] {
  const references = new Set<string>()
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const candidate = match[1]?.trim().replace(/^<|>$/gu, "")
    if (!candidate || /^(?:[a-z]+:|#|\/)/iu.test(candidate)) continue
    references.add(candidate.split("#", 1)[0] ?? candidate)
  }
  return [...references].filter(Boolean)
}

export async function readSkillSnapshotFile(
  snapshot: SkillRegistrySnapshot,
  skillId: string,
  relativePath = "SKILL.md",
): Promise<string> {
  const entry = snapshot.entries.get(skillId)
  if (!entry) throw new Error(`Skill is not present in this turn's snapshot: ${skillId}`)
  const root = await realpath(entry.root)
  const target = await realpath(path.resolve(root, relativePath))
  const relative = path.relative(root, target)
  if (!relative || relative === "SKILL.md") return readBoundedFile(target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Skill file path escapes the skill root.")
  return readBoundedFile(target)
}

async function readBoundedFile(filePath: string): Promise<string> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error("Skill resource is not a file.")
  if (info.size > MAX_SKILL_FILE_BYTES) throw new Error("Skill resource exceeds the 512 KiB safety limit.")
  return readFile(filePath, "utf8")
}

function parseFrontmatter(source: string): { description?: string; name?: string } {
  if (!source.startsWith("---")) return {}
  const end = source.indexOf("\n---", 3)
  if (end < 0) return {}
  const values: { description?: string; name?: string } = {}
  for (const line of source.slice(3, end).split(/\r?\n/u)) {
    const match = line.match(/^\s*(name|description)\s*:\s*(.*?)\s*$/u)
    if (!match?.[1] || !match[2]) continue
    const value = match[2].replace(/^(["'])(.*)\1$/u, "$2").trim()
    if (value) values[match[1] as "description" | "name"] = value
  }
  return values
}
