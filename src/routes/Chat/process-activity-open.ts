import type { ChatTurnProcessStatus } from "./chat-turns.ts"

export type ProcessOpenPreference = "auto" | "user_open" | "user_closed"

export function processRequiresAttention(status: ChatTurnProcessStatus): boolean {
  return status === "needsAction" || status === "error"
}

export function processShouldOpenAutomatically(status: ChatTurnProcessStatus, hasVisibleOutcome: boolean): boolean {
  return (
    status === "running" ||
    status === "retrying" ||
    processRequiresAttention(status) ||
    ((status === "completed" || status === "completedWithIssues" || status === "stopped") && !hasVisibleOutcome)
  )
}

export function processOpenAfterStatusChange(input: {
  hasVisibleOutcome: boolean
  preference: ProcessOpenPreference
  status: ChatTurnProcessStatus
}): boolean {
  if (processRequiresAttention(input.status)) {
    return true
  }
  if (input.preference === "user_open") {
    return true
  }
  if (input.preference === "user_closed") {
    return false
  }
  return processShouldOpenAutomatically(input.status, input.hasVisibleOutcome)
}
