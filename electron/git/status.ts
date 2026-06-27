import type { GitBranchInfo, GitRepositoryError, GitRepositoryState } from "./common.ts"

export interface GitCommandOutput {
  stderr: string
  stdout: string
}

export interface GitCommandError {
  code?: number | string
  message: string
  stderr?: string
  stdout?: string
  timedOut?: boolean
}

export interface GitCommandRunner {
  (args: string[], options?: { timeoutMs?: number }): Promise<GitCommandOutput>
}

const gitCommandTimeoutMs = 5_000

function emptyState(
  projectId: string,
  projectPath: string,
  error: GitRepositoryError,
  message?: string,
): GitRepositoryState {
  return {
    projectId,
    projectPath,
    available: false,
    branches: [],
    dirty: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    error,
    ...(message ? { message } : {}),
  }
}

function cleanGitMessage(value: string | undefined): string | undefined {
  const message = value?.trim()
  if (!message) {
    return undefined
  }
  return message.split("\n").slice(0, 4).join("\n")
}

export function classifyGitError(error: GitCommandError): { error: GitRepositoryError; message?: string } {
  if (error.timedOut) {
    return { error: "timeout", message: "Git command timed out." }
  }
  if (error.code === "ENOENT") {
    return { error: "git_unavailable", message: "Git executable was not found." }
  }
  const message = cleanGitMessage(error.stderr || error.message)
  if (message?.includes("not a git repository")) {
    return { error: "not_repository", message }
  }
  if (message?.includes("No such file or directory") || message?.includes("cannot change to")) {
    return { error: "path_unavailable", message }
  }
  return { error: "unknown", message }
}

export function parseBranchList(output: string, currentBranch?: string): GitBranchInfo[] {
  const branches = new Map<string, GitBranchInfo>()
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue
    }
    const [rawRefName = "", rawName = "", rawUpstream = ""] = line.split("\0")
    const refName = rawRefName.trim()
    const name = rawName.trim()
    if (!name || name.endsWith("/HEAD")) {
      continue
    }
    const remote = refName.startsWith("refs/remotes/")
    if (!remote && !refName.startsWith("refs/heads/")) {
      continue
    }
    if (remote) {
      const localName = name.slice(name.indexOf("/") + 1)
      if (branches.has(localName)) {
        continue
      }
    }
    branches.set(name, {
      name,
      current: currentBranch === name,
      remote,
      ...(rawUpstream.trim() ? { upstream: rawUpstream.trim() } : {}),
    })
  }
  return [...branches.values()].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1
    }
    if (left.remote !== right.remote) {
      return left.remote ? 1 : -1
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
  })
}

export function parsePorcelainStatus(
  output: string,
): Pick<GitRepositoryState, "dirty" | "stagedCount" | "unstagedCount" | "untrackedCount"> {
  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0
  for (const line of output.split("\n")) {
    if (!line || line.startsWith("##")) {
      continue
    }
    const index = line.charAt(0)
    const worktree = line.charAt(1)
    if (index === "?" && worktree === "?") {
      untrackedCount += 1
      continue
    }
    if (index !== " " && index !== "?") {
      stagedCount += 1
    }
    if (worktree !== " " && worktree !== "?") {
      unstagedCount += 1
    }
  }
  return {
    dirty: stagedCount + unstagedCount + untrackedCount > 0,
    stagedCount,
    unstagedCount,
    untrackedCount,
  }
}

export function normalizeCheckoutBranchName(branch: string): string | null {
  const name = branch.trim()
  if (!name || name.startsWith("-") || name.includes("\0") || name.includes("..")) {
    return null
  }
  return name
}

export async function readGitRepositoryState(
  projectId: string,
  projectPath: string,
  runGit: GitCommandRunner,
): Promise<GitRepositoryState> {
  const path = projectPath.trim()
  if (!projectId.trim() || !path) {
    return emptyState(projectId, projectPath, "path_unavailable")
  }
  let repositoryRoot: string
  try {
    repositoryRoot = (
      await runGit(["-C", path, "rev-parse", "--show-toplevel"], { timeoutMs: gitCommandTimeoutMs })
    ).stdout.trim()
  } catch (cause) {
    const classified = classifyGitError(cause as GitCommandError)
    return emptyState(projectId, path, classified.error, classified.message)
  }

  const [branchResult, headResult, branchListResult, statusResult] = await Promise.all([
    runGit(["-C", path, "branch", "--show-current"], { timeoutMs: gitCommandTimeoutMs }).catch(() => ({
      stdout: "",
      stderr: "",
    })),
    runGit(["-C", path, "rev-parse", "--short", "HEAD"], { timeoutMs: gitCommandTimeoutMs }).catch(() => ({
      stdout: "",
      stderr: "",
    })),
    runGit(
      [
        "-C",
        path,
        "for-each-ref",
        "--format=%(refname)%00%(refname:short)%00%(upstream:short)",
        "refs/heads",
        "refs/remotes",
      ],
      { timeoutMs: gitCommandTimeoutMs },
    ).catch(() => ({ stdout: "", stderr: "" })),
    runGit(["-C", path, "status", "--porcelain=v1", "--branch"], { timeoutMs: gitCommandTimeoutMs }).catch(() => ({
      stdout: "",
      stderr: "",
    })),
  ])
  const currentBranch = branchResult.stdout.trim()
  const detachedHead = currentBranch ? undefined : headResult.stdout.trim()
  const status = parsePorcelainStatus(statusResult.stdout)
  return {
    projectId,
    projectPath: path,
    available: true,
    repositoryRoot,
    branches: parseBranchList(branchListResult.stdout, currentBranch),
    ...status,
    ...(currentBranch ? { currentBranch } : {}),
    ...(detachedHead ? { detachedHead } : {}),
  }
}
