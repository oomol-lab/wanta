import type { AppUpdateState } from "../../electron/update/common.ts"

export type ManualUpdateCheckAction =
  | { type: "check" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "not-available"; version: string }
  | { type: "error" }
  | { type: "unavailable" }

export function shouldStartManualUpdateCheck(state: AppUpdateState | null): boolean {
  if (!state) {
    return true
  }
  if (!state.isPackaged) {
    return false
  }
  return state.status.status === "idle" || state.status.status === "not-available" || state.status.status === "error"
}

export function resolveManualUpdateCheckAction(state: AppUpdateState | null): ManualUpdateCheckAction {
  if (!state) {
    return { type: "check" }
  }
  if (!state.isPackaged) {
    return { type: "unavailable" }
  }

  switch (state.status.status) {
    case "checking":
      return { type: "checking" }
    case "available":
      return { type: "available", version: state.status.version }
    case "downloading":
      return { type: "downloading", percent: Math.round(state.status.percent ?? 0) }
    case "downloaded":
      return { type: "downloaded", version: state.status.version }
    case "not-available":
      return { type: "not-available", version: state.currentVersion }
    case "error":
      return { type: "error" }
    case "idle":
      return { type: "check" }
  }
}
