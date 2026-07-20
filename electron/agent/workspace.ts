import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"

/**
 * 在 rootDir 下生成 OpenCode workspace 的自定义工具文件（.opencode/tools/*.ts）与内置 skill（.opencode/skill/*）。
 * 幂等：每次启动覆盖写入，保证与内嵌源码 / 打包内置 skill 一致。返回 workspace 根目录（用作 sidecar 的 cwd）。
 *
 * OpenCode 会扫描 cwd 下 .opencode/{skill,skills}/<name>/SKILL.md，故把 oo 自带的 4 个 skill 拷到这里，
 * Wanta 自己的 agent 即可直接读到——不再依赖把 skill 释放到其他 AI agent 的家目录。
 */
export async function ensureAgentWorkspace(
  rootDir: string,
  bundledSkillsDir?: string,
  bundledToolRuntimePath?: string,
): Promise<string> {
  const opencodeDir = path.join(rootDir, ".opencode")
  const toolsDir = path.join(opencodeDir, "tools")
  const runtimeSkillsDir = path.join(opencodeDir, "skills")
  await rm(toolsDir, { force: true, recursive: true })
  await Promise.all([mkdir(toolsDir, { recursive: true }), mkdir(runtimeSkillsDir, { recursive: true })])
  await Promise.all(
    Object.entries(AGENT_TOOL_FILES).map(([name, source]) => writeFile(path.join(toolsDir, name), source, "utf-8")),
  )
  await syncToolRuntime(opencodeDir, bundledToolRuntimePath)
  await syncBundledSkills(opencodeDir, bundledSkillsDir)
  return rootDir
}

/** 把构建期合并的 tool helper + Zod runtime 覆盖到 workspace，工具加载不依赖 OpenCode 首启联网安装插件。 */
async function syncToolRuntime(opencodeDir: string, bundledToolRuntimePath: string | undefined): Promise<void> {
  const runtimeDir = path.join(opencodeDir, "runtime")
  if (!bundledToolRuntimePath) {
    return
  }
  const runtimeSource = await readFile(bundledToolRuntimePath)
  await mkdir(runtimeDir, { recursive: true })
  await writeFile(path.join(runtimeDir, "tool.js"), runtimeSource)
}

/**
 * 以打包内置 skill 为准重建 .opencode/skill/：先读源目录、确认可用后再清空旧目录逐个拷入。
 * 先读后删，避免源不可读时误删上一份好副本（rm 不能先于 readdir）。
 */
async function syncBundledSkills(opencodeDir: string, bundledSkillsDir: string | undefined): Promise<void> {
  const skillDir = path.join(opencodeDir, "skill")

  if (!bundledSkillsDir) {
    await rm(skillDir, { force: true, recursive: true })
    return
  }

  let entries
  try {
    entries = await readdir(bundledSkillsDir, { withFileTypes: true })
  } catch (error) {
    // 源缺失/不可读（如 dev 跳过 postinstall）：非致命——skills 全程 best-effort，不为 4 个可选 skill 阻断
    // agent 启动。但显式告警（不再静默），避免发布包遗漏 Resources/skills 时问题被完全掩盖；保留已有副本不删。
    console.warn(`[wanta] bundled skills source unavailable at ${bundledSkillsDir}; keeping existing skills:`, error)
    return
  }

  await rm(skillDir, { force: true, recursive: true })

  const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  if (skillNames.length === 0) {
    return
  }

  await mkdir(skillDir, { recursive: true })
  await Promise.all(
    skillNames.map((name) => cp(path.join(bundledSkillsDir, name), path.join(skillDir, name), { recursive: true })),
  )
}
