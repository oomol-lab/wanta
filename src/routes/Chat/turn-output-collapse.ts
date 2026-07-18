import type { TurnOutputFile, TurnOutputFileRole } from "../../../electron/chat/common.ts"

/** 默认只展开用户点选项或首项，避免大量 diff 同时请求、解析和挂载。 */
export function turnOutputInitialCollapsedPaths(
  _role: TurnOutputFileRole,
  files: readonly Pick<TurnOutputFile, "path">[],
  selectedPath?: string,
): Set<string> {
  const expandedPath = files.some((file) => file.path === selectedPath) ? selectedPath : files[0]?.path
  return new Set(files.filter((file) => file.path !== expandedPath).map((file) => file.path))
}
