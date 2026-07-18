import type { AssistantActivityEvent, ChatActiveRun } from "../../electron/chat/common.ts"
import type { ChatStatus } from "ai"

import * as React from "react"

const maxClearedActiveRunIds = 512

interface SessionRunView {
  activity?: AssistantActivityEvent
  startedAt?: number
  status: ChatStatus
}

export type ChatRunSessionsState = Record<string, SessionRunView>

export type ChatRunSessionsAction =
  | { activity: AssistantActivityEvent | undefined; sessionId: string; type: "set_activity" }
  | { run: ChatActiveRun | null; sessionId: string; type: "apply_run" }
  | { sessionId: string; status: ChatStatus; type: "set_status" }
  | { sessionId: string; type: "forget_session" }
  | { type: "reset" }

export interface ChatRunState {
  activities: Record<string, AssistantActivityEvent | undefined>
  applyActiveRun: (sessionId: string, run: ChatActiveRun | null, endedRunId?: string) => void
  forgetSession: (sessionId: string) => void
  getSessionRunStartedAt: (sessionId: string) => number | null
  getSessionStatus: (sessionId: string) => ChatStatus
  reset: () => void
  setActivity: (sessionId: string, activity: AssistantActivityEvent | undefined) => void
  setStatus: (sessionId: string, status: ChatStatus) => void
  statuses: Record<string, ChatStatus>
}

export function useChatRunState(): ChatRunState {
  const [sessions, dispatch] = React.useReducer(reduceChatRunSessions, {})
  const clearedActiveRunIds = React.useRef(new Set<string>())

  const setStatus = React.useCallback((sessionId: string, status: ChatStatus) => {
    dispatch({ sessionId, status, type: "set_status" })
  }, [])

  const setActivity = React.useCallback((sessionId: string, activity: AssistantActivityEvent | undefined) => {
    dispatch({ activity, sessionId, type: "set_activity" })
  }, [])

  const applyActiveRun = React.useCallback((sessionId: string, run: ChatActiveRun | null, endedRunId?: string) => {
    if (run) {
      if (clearedActiveRunIds.current.has(run.runId)) {
        return
      }
      dispatch({ run, sessionId: run.sessionId, type: "apply_run" })
      return
    }
    if (endedRunId) {
      clearedActiveRunIds.current.add(endedRunId)
      if (clearedActiveRunIds.current.size > maxClearedActiveRunIds) {
        const oldestRunId = clearedActiveRunIds.current.values().next().value
        if (oldestRunId) clearedActiveRunIds.current.delete(oldestRunId)
      }
    }
    dispatch({ run: null, sessionId, type: "apply_run" })
  }, [])

  const getSessionStatus = React.useCallback(
    (sessionId: string): ChatStatus => sessions[sessionId]?.status ?? "ready",
    [sessions],
  )
  const getSessionRunStartedAt = React.useCallback(
    (sessionId: string): number | null => sessions[sessionId]?.startedAt ?? null,
    [sessions],
  )

  const forgetSession = React.useCallback((sessionId: string): void => {
    dispatch({ sessionId, type: "forget_session" })
  }, [])

  const reset = React.useCallback((): void => {
    dispatch({ type: "reset" })
    clearedActiveRunIds.current.clear()
  }, [])

  const statuses = React.useMemo<Record<string, ChatStatus>>(
    () => Object.fromEntries(Object.entries(sessions).map(([sessionId, view]) => [sessionId, view.status])),
    [sessions],
  )
  const activities = React.useMemo<Record<string, AssistantActivityEvent | undefined>>(
    () =>
      Object.fromEntries(
        Object.entries(sessions).flatMap(([sessionId, view]) =>
          view.activity ? [[sessionId, view.activity] as const] : [],
        ),
      ),
    [sessions],
  )

  return {
    activities,
    applyActiveRun,
    forgetSession,
    getSessionRunStartedAt,
    getSessionStatus,
    reset,
    setActivity,
    setStatus,
    statuses,
  }
}

export function reduceChatRunSessions(
  state: ChatRunSessionsState,
  action: ChatRunSessionsAction,
): ChatRunSessionsState {
  if (action.type === "reset") return Object.keys(state).length === 0 ? state : {}
  if (action.type === "forget_session") return omitSessionRunView(state, action.sessionId)

  const current = state[action.sessionId] ?? { status: "ready" }
  if (action.type === "set_status") {
    if (current.status === action.status) return state
    return setSessionRunView(state, action.sessionId, { ...current, status: action.status })
  }
  if (action.type === "set_activity") {
    if (sameAssistantActivity(current.activity, action.activity)) return state
    const next = { ...current }
    if (action.activity) next.activity = action.activity
    else delete next.activity
    return setSessionRunView(state, action.sessionId, next)
  }
  if (action.run) {
    const next: SessionRunView = {
      startedAt: action.run.startedAt,
      status: action.run.phase === "sending" || action.run.phase === "submitted" ? "submitted" : "streaming",
    }
    const activity = activityForActiveRun(action.run)
    if (activity) next.activity = activity
    return sameSessionRunView(current, next) ? state : { ...state, [action.sessionId]: next }
  }

  const next = { ...current }
  delete next.activity
  delete next.startedAt
  if (next.status === "submitted" || next.status === "streaming") next.status = "ready"
  return setSessionRunView(state, action.sessionId, next)
}

function setSessionRunView(state: ChatRunSessionsState, sessionId: string, view: SessionRunView): ChatRunSessionsState {
  if (view.status === "ready" && !view.activity && view.startedAt === undefined) {
    return omitSessionRunView(state, sessionId)
  }
  return { ...state, [sessionId]: view }
}

function omitSessionRunView(state: ChatRunSessionsState, sessionId: string): ChatRunSessionsState {
  if (!Object.hasOwn(state, sessionId)) return state
  const next = { ...state }
  delete next[sessionId]
  return next
}

function sameSessionRunView(left: SessionRunView, right: SessionRunView): boolean {
  return (
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    sameAssistantActivity(left.activity, right.activity)
  )
}

function sameAssistantActivity(
  left: AssistantActivityEvent | undefined,
  right: AssistantActivityEvent | undefined,
): boolean {
  if (!left || !right) {
    return left === right
  }
  return (
    left.sessionId === right.sessionId &&
    left.messageId === right.messageId &&
    left.phase === right.phase &&
    left.message === right.message &&
    left.attempt === right.attempt &&
    left.nextRetryAt === right.nextRetryAt
  )
}

function activityForActiveRun(run: ChatActiveRun): AssistantActivityEvent | undefined {
  if (run.phase !== "sending" && run.phase !== "submitted" && run.phase !== "thinking") {
    return undefined
  }
  return {
    sessionId: run.sessionId,
    ...(run.activeAssistantMessageId ? { messageId: run.activeAssistantMessageId } : {}),
    phase: "thinking",
  }
}
