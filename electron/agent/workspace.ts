import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"

/**
 * 在 rootDir 下生成 OpenCode workspace 的自定义工具文件（.opencode/tools/*.ts）与内置 skill（.opencode/skill/*）。
 * 幂等：每次启动覆盖写入，保证与内嵌源码 / 打包内置 skill 一致。返回 workspace 根目录（用作 sidecar 的 cwd）。
 *
 * OpenCode 会扫描 cwd 下 .opencode/{skill,skills}/<name>/SKILL.md，故把 oo 自带的 4 个 skill 拷到这里，
 * Lumo 自己的 agent 即可直接读到——不再依赖把 skill 释放到其他 AI agent 的家目录。
 */
export async function ensureAgentWorkspace(rootDir: string, bundledSkillsDir?: string): Promise<string> {
  const opencodeDir = path.join(rootDir, ".opencode")
  const toolsDir = path.join(opencodeDir, "tools")
  await mkdir(toolsDir, { recursive: true })
  await Promise.all(
    Object.entries(AGENT_TOOL_FILES).map(([name, source]) => writeFile(path.join(toolsDir, name), source, "utf-8")),
  )
  await syncBundledSkills(opencodeDir, bundledSkillsDir)
  return rootDir
}

/** 以打包内置 skill 为准重建 .opencode/skill/：先清空（避免旧版本/已移除的 skill 残留）再逐个拷入。 */
async function syncBundledSkills(opencodeDir: string, bundledSkillsDir: string | undefined): Promise<void> {
  const skillDir = path.join(opencodeDir, "skill")
  await rm(skillDir, { force: true, recursive: true })

  if (!bundledSkillsDir) {
    return
  }

  let entries
  try {
    entries = await readdir(bundledSkillsDir, { withFileTypes: true })
  } catch {
    // dev 未导出内置 skill（如跳过 postinstall）时静默跳过；predev 守卫负责提示缺失。
    return
  }

  const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  if (skillNames.length === 0) {
    return
  }

  await mkdir(skillDir, { recursive: true })
  await Promise.all(
    skillNames.map((name) => cp(path.join(bundledSkillsDir, name), path.join(skillDir, name), { recursive: true })),
  )
}
