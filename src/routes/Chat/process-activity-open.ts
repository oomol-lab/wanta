import type { ChatTurnProcessStatus } from "./chat-turns.ts"

export type ProcessOpenPreference = "auto" | "user_open" | "user_closed"

export function processRequiresAttention(status: ChatTurnProcessStatus, hasFinalAnswer: boolean): boolean {
  return status === "needsAction" || (status === "error" && !hasFinalAnswer)
}

export function processShouldOpenAutomatically(status: ChatTurnProcessStatus, hasFinalAnswer: boolean): boolean {
  return status === "running" || status === "retrying" || status === "needsAction" || !hasFinalAnswer
}

export function processOpenAfterStatusChange(input: {
  hasFinalAnswer: boolean
  preference: ProcessOpenPreference
  status: ChatTurnProcessStatus
}): boolean {
  if (processRequiresAttention(input.status, input.hasFinalAnswer)) {
    return true
  }
  if (input.preference === "user_open") {
    return true
  }
  if (input.preference === "user_closed") {
    return false
  }
  return processShouldOpenAutomatically(input.status, input.hasFinalAnswer)
}
