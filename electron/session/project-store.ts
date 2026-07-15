import type { SessionProject, SessionScope } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface PersistedSessionProjects {
  projects?: Record<string, SessionProject>
  version?: number
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function normalizeScope(value: unknown): SessionScope | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }
  const source = value as Partial<SessionScope>
  const rawOrganizationId = "organizationId" in source ? source.organizationId : undefined
  const rawOrganizationName = "organizationName" in source ? source.organizationName : undefined
  const organizationId = typeof rawOrganizationId === "string" ? rawOrganizationId.trim() : undefined
  const organizationName = typeof rawOrganizationName === "string" ? rawOrganizationName.trim() : undefined
  if (!organizationId || !organizationName) {
    return undefined
  }
  return { organizationId, organizationName }
}

function normalizeProject(id: string, value: unknown): SessionProject | null {
  if (!id || !value || typeof value !== "object") {
    return null
  }
  const source = value as Partial<SessionProject>
  const projectPath = typeof source.path === "string" ? source.path.trim() : ""
  if (!projectPath) {
    return null
  }
  const name = typeof source.name === "string" ? source.name.trim() : ""
  const createdAt = validTimestamp(source.createdAt) ? source.createdAt : Date.now()
  const updatedAt = validTimestamp(source.updatedAt) ? source.updatedAt : createdAt
  const scope = normalizeScope(source.scope)
  return {
    id,
    name: name || path.basename(projectPath.replace(/[\\/]+$/, "")) || projectPath,
    path: projectPath,
    createdAt,
    updatedAt,
    ...(scope ? { scope } : {}),
    ...(validTimestamp(source.pinnedAt) ? { pinnedAt: source.pinnedAt } : {}),
    ...(validTimestamp(source.archivedAt) ? { archivedAt: source.archivedAt } : {}),
  }
}

function normalizeProjects(value: unknown): Map<string, SessionProject> {
  const record = value && typeof value === "object" ? (value as PersistedSessionProjects).projects : undefined
  const projects = new Map<string, SessionProject>()
  if (!record || typeof record !== "object") {
    return projects
  }
  for (const [id, entry] of Object.entries(record)) {
    const project = normalizeProject(id, entry)
    if (project) {
      projects.set(id, project)
    }
  }
  return projects
}

function serializeProjects(projects: Map<string, SessionProject>): PersistedSessionProjects {
  const record: Record<string, SessionProject> = {}
  for (const [id, project] of projects.entries()) {
    const normalized = normalizeProject(id, project)
    if (normalized) {
      record[id] = normalized
    }
  }
  return { version: 1, projects: record }
}

/** 本地项目列表：只保存用户选择的目录和展示状态，不触碰 OpenCode 会话本体。 */
export class SessionProjectStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "session-projects.json")
  }

  public async read(): Promise<Map<string, SessionProject>> {
    try {
      return normalizeProjects(JSON.parse(await readFile(this.file, "utf-8")))
    } catch (error) {
      logStoreReadFailure("session projects", this.file, error)
      return new Map()
    }
  }

  public async write(projects: Map<string, SessionProject>): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeProjects(projects), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
}
