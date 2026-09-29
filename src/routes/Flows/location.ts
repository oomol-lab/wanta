import type { WorkbenchLocation } from "@oomol-lab/open-flow/workbench"

/** Hash links remain internal in development and under Electron's file:// renderer. */
export function workbenchHref(location: WorkbenchLocation): string {
  if (!location.flowId) return "#flows"
  const source = location.view === "runs" && location.runSource ? `?source=${location.runSource}` : ""
  return `#flows/${encodeURIComponent(location.flowId)}/${location.view}${source}`
}
