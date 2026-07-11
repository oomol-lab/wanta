import type { TurnOutputFile, TurnOutputFileRole } from "../../../electron/chat/common.ts"

/** 过程文件默认只展开首项，避免临时脚本和日志同时撑满审查面板。 */
export function turnOutputInitialCollapsedPaths(
  role: TurnOutputFileRole,
  files: readonly Pick<TurnOutputFile, "path">[],
): Set<string> {
  if (role !== "process") {
    return new Set()
  }
  return new Set(files.slice(1).map((file) => file.path))
}
