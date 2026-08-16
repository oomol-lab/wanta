import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"

/** Host-owned managed artifact and process directories shared by every agent adapter. */
export class ManagedTurnDirectories {
  private readonly rootDir: string

  public constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  public async createArtifactDir(sessionId: string, projectRoot?: string): Promise<string> {
    if (projectRoot) return this.createProjectArtifactDir(sessionId, projectRoot)
    return this.createTurnDir("artifacts", sessionId)
  }

  public artifactSessionDir(sessionId: string, projectRoot?: string): string {
    if (projectRoot) {
      return path.resolve(projectRoot, ".wanta", "artifacts", sanitizePathSegment(sessionId))
    }
    return this.sessionTurnRoot("artifacts", sessionId)
  }

  public createProcessDir(sessionId: string): Promise<string> {
    return this.createTurnDir("process", sessionId)
  }

  /** Stable parent of every process directory created for this session. */
  public processSessionDir(sessionId: string): string {
    return this.sessionTurnRoot("process", sessionId)
  }

  private async createTurnDir(kind: "artifacts" | "process", sessionId: string): Promise<string> {
    const root = this.sessionTurnRoot(kind, sessionId)
    await mkdir(root, { recursive: true })
    return createUniqueTurnDir(root)
  }

  private async createProjectArtifactDir(sessionId: string, projectRoot: string): Promise<string> {
    const requestedProjectRoot = path.resolve(projectRoot)
    const requestedProjectStat = await lstat(requestedProjectRoot)
    if (!requestedProjectStat.isDirectory() || requestedProjectStat.isSymbolicLink()) {
      throw new Error("Project artifact root is not a directory.")
    }
    const resolvedProjectRoot = await realpath(requestedProjectRoot)
    const resolvedProjectStat = await lstat(resolvedProjectRoot)
    if (!resolvedProjectStat.isDirectory() || resolvedProjectStat.isSymbolicLink()) {
      throw new Error("Project artifact root is not a directory.")
    }
    const sessionRoot = await ensureProjectArtifactSessionRoot(resolvedProjectRoot, sessionId)
    return createUniqueTurnDir(sessionRoot)
  }

  private sessionTurnRoot(kind: "artifacts" | "process", sessionId: string): string {
    const root = path.resolve(this.rootDir, kind)
    const dir = path.resolve(root, sanitizePathSegment(sessionId))
    if (!pathInside(root, dir)) throw new Error("Invalid session directory segment.")
    return dir
  }
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)
  return cleaned || "session"
}

async function createUniqueTurnDir(root: string): Promise<string> {
  const resolvedDir = path.resolve(root, `${Date.now()}-${randomUUID()}`)
  if (!pathInside(root, resolvedDir)) throw new Error("Invalid turn directory segment.")
  await mkdir(resolvedDir)
  return resolvedDir
}

async function ensurePlainDirectory(parent: string, name: string): Promise<string> {
  const directory = path.join(parent, name)
  try {
    await mkdir(directory)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
  }
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Project artifact path contains a non-directory or symbolic link.")
  }
  return directory
}

async function ensureProjectArtifactSessionRoot(projectRoot: string, sessionId: string): Promise<string> {
  const wantaRoot = await ensurePlainDirectory(projectRoot, ".wanta")
  const artifactsRoot = await ensurePlainDirectory(wantaRoot, "artifacts")
  const sessionRoot = await ensurePlainDirectory(artifactsRoot, sanitizePathSegment(sessionId))
  const resolvedSessionRoot = await realpath(sessionRoot)
  if (!pathInside(projectRoot, resolvedSessionRoot)) {
    throw new Error("Project artifact directory resolves outside the project.")
  }
  return resolvedSessionRoot
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
