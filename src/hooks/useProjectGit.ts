import type { GitRepositoryState } from "../../electron/git/common.ts"
import type { SessionProject } from "../../electron/session/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { useGitService } from "@/components/AppContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface UseProjectGit {
  checkoutBranch: (branch: string) => Promise<GitRepositoryState | null>
  createAndCheckoutBranch: (branch: string) => Promise<GitRepositoryState | null>
  error: UserFacingError | null
  loading: boolean
  refresh: () => Promise<GitRepositoryState | null>
  state: GitRepositoryState | null
}

export function useProjectGit(project: SessionProject | undefined): UseProjectGit {
  const gitService = useGitService()
  const [state, setState] = React.useState<GitRepositoryState | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const requestSequence = React.useRef(0)
  const projectId = project?.id ?? ""
  const projectPath = project?.path ?? ""

  const refresh = React.useCallback(async (): Promise<GitRepositoryState | null> => {
    const requestId = ++requestSequence.current
    if (!projectId || !projectPath) {
      setState(null)
      setError(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    try {
      const next = await gitService.invoke("getRepositoryState", { projectId, path: projectPath })
      if (requestId === requestSequence.current) {
        setState(next)
        setError(null)
      }
      return next
    } catch (cause) {
      reportRendererHandledError("git", "repository state refresh failed", cause)
      if (requestId === requestSequence.current) {
        setError(resolveUserFacingError(cause, { area: "session" }))
        setState(null)
      }
      return null
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false)
      }
    }
  }, [gitService, projectId, projectPath])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const checkoutBranch = React.useCallback(
    async (branch: string): Promise<GitRepositoryState | null> => {
      if (!projectId || !projectPath) {
        return null
      }
      const requestId = ++requestSequence.current
      setLoading(true)
      try {
        const next = await gitService.invoke("checkoutBranch", { projectId, path: projectPath, branch })
        if (requestId === requestSequence.current) {
          setState(next)
          setError(null)
        }
        return next
      } catch (cause) {
        reportRendererHandledError("git", "branch checkout failed", cause)
        if (requestId === requestSequence.current) {
          setError(resolveUserFacingError(cause, { area: "session" }))
        }
        return null
      } finally {
        if (requestId === requestSequence.current) {
          setLoading(false)
        }
      }
    },
    [gitService, projectId, projectPath],
  )

  const createAndCheckoutBranch = React.useCallback(
    async (branch: string): Promise<GitRepositoryState | null> => {
      if (!projectId || !projectPath) {
        return null
      }
      const requestId = ++requestSequence.current
      setLoading(true)
      try {
        const next = await gitService.invoke("createAndCheckoutBranch", { projectId, path: projectPath, branch })
        if (requestId === requestSequence.current) {
          setState(next)
          setError(null)
        }
        return next
      } catch (cause) {
        reportRendererHandledError("git", "branch create and checkout failed", cause)
        if (requestId === requestSequence.current) {
          setError(resolveUserFacingError(cause, { area: "session" }))
        }
        return null
      } finally {
        if (requestId === requestSequence.current) {
          setLoading(false)
        }
      }
    },
    [gitService, projectId, projectPath],
  )

  return { checkoutBranch, createAndCheckoutBranch, error, loading, refresh, state }
}
