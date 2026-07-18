import type { SessionProjectStore } from "../session/project-store.ts"
import type {
  GitCheckoutBranchRequest,
  GitCreateBranchRequest,
  GitRepositoryRequest,
  GitRepositoryState,
  GitService,
} from "./common.ts"
import type { GitCommandError, GitCommandOutput } from "./status.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { GitService as GitServiceName } from "./common.ts"
import { classifyGitError, normalizeCheckoutBranchName, readGitRepositoryState } from "./status.ts"

const execFileAsync = promisify(execFile)
const gitCommandTimeoutMs = 5_000
const gitMutationTimeoutMs = 60_000

interface GitServiceDeps {
  projectStore?: Pick<SessionProjectStore, "read">
}

async function runGit(args: string[], options: { timeoutMs?: number } = {}): Promise<GitCommandOutput> {
  try {
    const result = await execFileAsync("git", args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: options.timeoutMs ?? gitCommandTimeoutMs,
      windowsHide: true,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & {
      killed?: boolean
      signal?: NodeJS.Signals
      stderr?: string
      stdout?: string
    }
    const normalized: GitCommandError = {
      code: error.code,
      message: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
      timedOut: error.killed || error.signal === "SIGTERM",
    }
    throw normalized
  }
}

function failedCheckoutState(
  req: GitCheckoutBranchRequest | GitCreateBranchRequest,
  error: GitCommandError,
): GitRepositoryState {
  const classified = classifyGitError(error)
  return {
    projectId: req.projectId,
    projectPath: req.path,
    available: false,
    branches: [],
    dirty: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    error: classified.error,
    ...(classified.message ? { message: classified.message } : {}),
  }
}

function unavailableProjectState(req: GitRepositoryRequest, message: string): GitRepositoryState {
  return {
    projectId: req.projectId,
    projectPath: req.path,
    available: false,
    branches: [],
    dirty: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    error: "path_unavailable",
    message,
  }
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/[\\/]+$/, "")
}

async function stateAfterCheckoutFailure(
  req: GitCheckoutBranchRequest | GitCreateBranchRequest,
  error: GitCommandError,
): Promise<GitRepositoryState> {
  const classified = classifyGitError(error)
  const state = await readGitRepositoryState(req.projectId, req.path, runGit)
  if (!state.available) {
    return failedCheckoutState(req, error)
  }
  return {
    ...state,
    error: classified.error,
    ...(classified.message ? { message: classified.message } : {}),
  }
}

export class GitServiceImpl extends ConnectionService<GitService> implements IConnectionService<GitService> {
  private readonly deps: GitServiceDeps

  public constructor(deps: GitServiceDeps = {}) {
    super(GitServiceName)
    this.deps = deps
  }

  public async getRepositoryState(req: GitRepositoryRequest): Promise<GitRepositoryState> {
    const checked = await this.registeredProjectRequest(req)
    if (!checked) {
      return unavailableProjectState(req, "Project is not registered.")
    }
    return readGitRepositoryState(checked.projectId, checked.path, runGit)
  }

  public async checkoutBranch(req: GitCheckoutBranchRequest): Promise<GitRepositoryState> {
    const branch = normalizeCheckoutBranchName(req.branch)
    if (!branch) {
      throw new Error("Branch name is required.")
    }
    const checked = await this.registeredProjectRequest(req)
    if (!checked) {
      return unavailableProjectState(req, "Project is not registered.")
    }
    try {
      await runGit(["-C", checked.path, "checkout", branch], { timeoutMs: gitMutationTimeoutMs })
    } catch (cause) {
      return stateAfterCheckoutFailure({ ...req, path: checked.path }, cause as GitCommandError)
    }
    return readGitRepositoryState(checked.projectId, checked.path, runGit)
  }

  public async createAndCheckoutBranch(req: GitCreateBranchRequest): Promise<GitRepositoryState> {
    const branch = normalizeCheckoutBranchName(req.branch)
    if (!branch) {
      throw new Error("Branch name is required.")
    }
    const checked = await this.registeredProjectRequest(req)
    if (!checked) {
      return unavailableProjectState(req, "Project is not registered.")
    }
    try {
      await runGit(["-C", checked.path, "checkout", "-b", branch], { timeoutMs: gitMutationTimeoutMs })
    } catch (cause) {
      return stateAfterCheckoutFailure({ ...req, path: checked.path }, cause as GitCommandError)
    }
    return readGitRepositoryState(checked.projectId, checked.path, runGit)
  }

  private async registeredProjectRequest(req: GitRepositoryRequest): Promise<GitRepositoryRequest | null> {
    if (!this.deps.projectStore) {
      return { ...req, path: normalizeProjectPath(req.path) }
    }
    const project = (await this.deps.projectStore.read()).get(req.projectId)
    if (!project || project.archivedAt) {
      return null
    }
    if (normalizeProjectPath(project.path) !== normalizeProjectPath(req.path)) {
      return null
    }
    return { projectId: project.id, path: normalizeProjectPath(project.path) }
  }
}
