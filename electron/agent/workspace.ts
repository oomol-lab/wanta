import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"

/**
 * 在 rootDir 下生成 OpenCode workspace 的自定义工具文件（.opencode/tools/*.ts）。
 * 幂等：每次启动覆盖写入，保证与内嵌源码一致。返回 workspace 根目录（用作 sidecar 的 cwd）。
 */
export async function ensureAgentWorkspace(rootDir: string): Promise<string> {
  const toolsDir = path.join(rootDir, ".opencode", "tools")
  await mkdir(toolsDir, { recursive: true })
  await Promise.all(
    Object.entries(AGENT_TOOL_FILES).map(([name, source]) => writeFile(path.join(toolsDir, name), source, "utf-8")),
  )
  return rootDir
}
