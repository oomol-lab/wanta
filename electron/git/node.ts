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

export class GitServiceImpl extends ConnectionService<GitService> implements IConnectionService<GitService> {
  public constructor() {
    super(GitServiceName)
  }

  public async getRepositoryState(req: GitRepositoryRequest): Promise<GitRepositoryState> {
    return readGitRepositoryState(req.projectId, req.path, runGit)
  }

  public async checkoutBranch(req: GitCheckoutBranchRequest): Promise<GitRepositoryState> {
    const branch = normalizeCheckoutBranchName(req.branch)
    if (!branch) {
      throw new Error("Branch name is required.")
    }
    try {
      await runGit(["-C", req.path, "checkout", branch], { timeoutMs: gitCommandTimeoutMs })
    } catch (cause) {
      return failedCheckoutState(req, cause as GitCommandError)
    }
    return readGitRepositoryState(req.projectId, req.path, runGit)
  }

  public async createAndCheckoutBranch(req: GitCreateBranchRequest): Promise<GitRepositoryState> {
    const branch = normalizeCheckoutBranchName(req.branch)
    if (!branch) {
      throw new Error("Branch name is required.")
    }
    try {
      await runGit(["-C", req.path, "checkout", "-b", branch], { timeoutMs: gitCommandTimeoutMs })
    } catch (cause) {
      return failedCheckoutState(req, cause as GitCommandError)
    }
    return readGitRepositoryState(req.projectId, req.path, runGit)
  }
}
