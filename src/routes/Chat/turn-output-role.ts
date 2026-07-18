import type { TurnOutputFileRole } from "../../../electron/chat/common.ts"

/** 只在目标角色确实有文件时采用，否则回退到本轮实际可用的另一类文件。 */
export function availableTurnOutputRole(
  preferred: TurnOutputFileRole,
  processFileCount: number,
  projectChangeFileCount: number,
  projectChangesTruncated = false,
): TurnOutputFileRole {
  if (preferred === "process" && processFileCount > 0) {
    return "process"
  }
  if (preferred === "project_change" && (projectChangeFileCount > 0 || projectChangesTruncated)) {
    return "project_change"
  }
  return projectChangeFileCount > 0 || projectChangesTruncated ? "project_change" : "process"
}
