import type { AssistantActivityEvent, ChatActiveRun } from "../../electron/chat/common.ts"
import type { ChatStatus } from "ai"

import * as React from "react"

export interface ChatRunState {
  activities: Record<string, AssistantActivityEvent | undefined>
  applyActiveRun: (sessionId: string, run: ChatActiveRun | null, endedRunId?: string) => void
  getSessionRunStartedAt: (sessionId: string) => number | null
  getSessionStatus: (sessionId: string) => ChatStatus
  setActivity: (sessionId: string, activity: AssistantActivityEvent | undefined) => void
  setStatus: (sessionId: string, status: ChatStatus) => void
  statuses: Record<string, ChatStatus>
}

export function useChatRunState(): ChatRunState {
  const [statuses, setStatuses] = React.useState<Record<string, ChatStatus>>({})
  const [activities, setActivities] = React.useState<Record<string, AssistantActivityEvent | undefined>>({})
  const [activeRunStarts, setActiveRunStarts] = React.useState<Record<string, number | undefined>>({})
  const clearedActiveRunIds = React.useRef(new Set<string>())

  const setStatus = React.useCallback((sessionId: string, status: ChatStatus) => {
    setStatuses((current) => (current[sessionId] === status ? current : { ...current, [sessionId]: status }))
  }, [])

  const setActivity = React.useCallback((sessionId: string, activity: AssistantActivityEvent | undefined) => {
    setActivities((current) => setSessionActivity(current, sessionId, activity))
  }, [])

  const applyActiveRun = React.useCallback(
    (sessionId: string, run: ChatActiveRun | null, endedRunId?: string) => {
      if (run) {
        if (clearedActiveRunIds.current.has(run.runId)) {
          return
        }
        setActiveRunStarts((current) =>
          current[run.sessionId] === run.startedAt ? current : { ...current, [run.sessionId]: run.startedAt },
        )
        setStatus(run.sessionId, run.phase === "sending" || run.phase === "submitted" ? "submitted" : "streaming")
        setActivity(run.sessionId, activityForActiveRun(run))
        return
      }
      if (endedRunId) {
        clearedActiveRunIds.current.add(endedRunId)
      }
      setActiveRunStarts((current) => {
        if (!Object.hasOwn(current, sessionId)) {
          return current
        }
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      setStatuses((current) => {
        const status = current[sessionId]
        if (status !== "submitted" && status !== "streaming") {
          return current
        }
        return { ...current, [sessionId]: "ready" }
      })
      setActivity(sessionId, undefined)
    },
    [setActivity, setStatus],
  )

  const getSessionStatus = React.useCallback(
    (sessionId: string): ChatStatus => statuses[sessionId] ?? "ready",
    [statuses],
  )
  const getSessionRunStartedAt = React.useCallback(
    (sessionId: string): number | null => activeRunStarts[sessionId] ?? null,
    [activeRunStarts],
  )

  return {
    activities,
    applyActiveRun,
    getSessionRunStartedAt,
    getSessionStatus,
    setActivity,
    setStatus,
    statuses,
  }
}

function setSessionActivity(
  activities: Record<string, AssistantActivityEvent | undefined>,
  sessionId: string,
  activity: AssistantActivityEvent | undefined,
): Record<string, AssistantActivityEvent | undefined> {
  if (sameAssistantActivity(activities[sessionId], activity)) {
    return activities
  }
  if (!activity) {
    if (!Object.hasOwn(activities, sessionId)) {
      return activities
    }
    const next = { ...activities }
    delete next[sessionId]
    return next
  }
  return { ...activities, [sessionId]: activity }
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
