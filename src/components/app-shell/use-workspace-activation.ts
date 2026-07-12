import type { WorkspaceActivationInput, WorkspaceActivationState } from "./app-shell-model.ts"

import * as React from "react"
import {
  resolveWorkspaceActivationState,
  shouldClearWorkspaceSwitchTarget,
  workspaceActivationBlocksInput,
  workspaceActivationIsPending,
  WORKSPACE_SWITCH_TIMEOUT_MS,
} from "./app-shell-model.ts"

export interface WorkspaceActivationController {
  activationBlocked: boolean
  activationState: WorkspaceActivationState
  handleSwitchStart: (targetScopeKey: string) => void
  navigationSwitching: boolean
}

export function useWorkspaceActivation({
  activationInput,
  activeWorkspaceKey,
  hasLoadedOrganizations,
  loadingOrganizations,
  organizationIds,
}: {
  activationInput: Omit<WorkspaceActivationInput, "targetScopeKey">
  activeWorkspaceKey: string
  hasLoadedOrganizations: boolean
  loadingOrganizations: boolean
  organizationIds: string[]
}): WorkspaceActivationController {
  const [targetScopeKey, setTargetScopeKey] = React.useState<string | null>(null)
  const [timedOutKey, setTimedOutKey] = React.useState<string | null>(null)
  const switchStartedAt = React.useRef<number | null>(null)
  const observedWorkspaceKey = React.useRef<string | null>(null)
  const activationState = resolveWorkspaceActivationState({ ...activationInput, targetScopeKey })
  const switching = workspaceActivationIsPending(activationState)
  const timedOut = Boolean(targetScopeKey && timedOutKey === targetScopeKey)

  const handleSwitchStart = React.useCallback((nextScopeKey: string): void => {
    switchStartedAt.current = Date.now()
    setTimedOutKey(null)
    setTargetScopeKey(nextScopeKey)
  }, [])

  React.useLayoutEffect(() => {
    if (observedWorkspaceKey.current === null) {
      observedWorkspaceKey.current = activeWorkspaceKey
      return
    }
    if (observedWorkspaceKey.current === activeWorkspaceKey) {
      return
    }
    observedWorkspaceKey.current = activeWorkspaceKey
    // 组织管理页也能切 workspace，这里把非侧边栏入口并入同一套 activation 流。
    handleSwitchStart(activeWorkspaceKey)
  }, [activeWorkspaceKey, handleSwitchStart])

  React.useEffect(() => {
    if (!targetScopeKey) {
      switchStartedAt.current = null
      return
    }
    if (
      shouldClearWorkspaceSwitchTarget({
        activeWorkspaceKey,
        hasLoadedOrganizations,
        loadingOrganizations,
        organizationIds,
        targetScopeKey,
        workspaceSwitching: switching,
      })
    ) {
      setTimedOutKey(null)
      setTargetScopeKey(null)
    }
  }, [activeWorkspaceKey, hasLoadedOrganizations, loadingOrganizations, organizationIds, switching, targetScopeKey])

  React.useEffect(() => {
    if (!targetScopeKey) {
      setTimedOutKey(null)
      return
    }
    const startedAt = switchStartedAt.current ?? Date.now()
    switchStartedAt.current = startedAt
    const remainingMs = WORKSPACE_SWITCH_TIMEOUT_MS - (Date.now() - startedAt)
    if (remainingMs <= 0) {
      setTimedOutKey(targetScopeKey)
      return
    }
    // 超时只释放 workspace 选择器，不把真实切换状态伪装成完成。
    const timeoutId = window.setTimeout(() => {
      setTimedOutKey((current) => current ?? targetScopeKey)
    }, remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [targetScopeKey])

  return {
    activationBlocked: workspaceActivationBlocksInput(activationState),
    activationState,
    handleSwitchStart,
    navigationSwitching: switching && !timedOut,
  }
}
