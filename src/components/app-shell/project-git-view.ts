import type { GitRepositoryState } from "../../../electron/git/common.ts"
import type { SessionProject } from "../../../electron/session/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

export type ProjectGitView =
  | { kind: "no_project" }
  | { kind: "loading" }
  | { kind: "ready"; branchLabel: string; state: GitRepositoryState }
  | { kind: "not_repository"; message?: string; state: GitRepositoryState }
  | { kind: "unavailable"; message?: string; state?: GitRepositoryState; error?: UserFacingError }

export function projectGitView({
  error,
  loading,
  project,
  state,
}: {
  error: UserFacingError | null
  loading: boolean
  project?: SessionProject
  state: GitRepositoryState | null
}): ProjectGitView {
  if (!project) {
    return { kind: "no_project" }
  }
  if (loading && !state) {
    return { kind: "loading" }
  }
  if (state?.available) {
    const branchLabel = state.currentBranch ?? (state.detachedHead ? `HEAD ${state.detachedHead}` : "")
    return branchLabel ? { kind: "ready", branchLabel, state } : { kind: "unavailable", state }
  }
  if (state?.error === "not_repository") {
    return { kind: "not_repository", message: state.message, state }
  }
  if (state) {
    return { kind: "unavailable", message: state.message, state }
  }
  if (error) {
    return { kind: "unavailable", error }
  }
  return { kind: "loading" }
}
