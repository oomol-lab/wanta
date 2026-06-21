// 静态内置 oo 自带 skill：构建期用 oo 二进制把 oo bundled skill 导出到 resources/skills/（gitignore），
// 供 dev 与打包共用。运行时由 electron/agent/workspace.ts 拷进 OpenCode workspace 的 .opencode/skill/，
// 使 Lumo 自己的 agent 直接读到这 4 个 skill——不再像旧 oo-cli 那样把 skill 释放到其他 AI agent 家目录。
//
// 与二进制下载同源：先经 downloadOoBinary() 确保当前平台 oo 就绪，再以 `oo skills install --out-dir` 导出。
// `--out-dir` 只写指定目录；仍隔离 OO_CONFIG/DATA/LOG 到临时目录并禁用 sync，避免污染开发机家目录。

import { spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { downloadOoBinary } from "./oo-cli.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")

// 导出落地目录（gitignore）。dev 运行时与生产打包都以此为源；运行时路径解析见 electron/agent/binaries.ts。
export const bundledSkillsDir = path.join(repoRoot, "resources", "skills")

// oo 自带且需内置的 skill；用于导出后的完整性校验（数量/缺失）。
export const bundledSkillIds = ["oo", "oo-find-skills", "oo-create-skill", "oo-publish-skill"] as const

interface SkillsInstallExport {
  status?: string
  summary?: { requestedSkills?: number; exported?: number; failed?: number }
  skills?: Array<{ skillId?: string; status?: string }>
}

/**
 * 把 oo bundled skill 导出到 outDir（默认 resources/skills/）。幂等：先清空目录再导出，避免旧版本残留。
 * 返回导出目录绝对路径。导出失败或 4 个 skill 未全部导出则抛错。
 */
export async function exportBundledSkills(outDir: string = bundledSkillsDir): Promise<string> {
  const ooBin = await downloadOoBinary()
  const storeDir = path.join(os.tmpdir(), "lumo-oo-skill-export-store")

  await rm(outDir, { force: true, recursive: true })
  await mkdir(outDir, { recursive: true })

  const result = spawnSync(ooBin, ["skills", "install", `--out-dir=${outDir}`, "--agent-format=universal", "--json"], {
    encoding: "utf-8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      OO_CONFIG_DIR: path.join(storeDir, "config"),
      OO_DATA_DIR: path.join(storeDir, "data"),
      OO_LOG_DIR: path.join(storeDir, "log"),
      OO_SKILLS_SYNC_DISABLED: "1",
      OO_NO_SELF_UPDATE: "1",
      OO_TELEMETRY_DISABLED: "1",
    },
  })

  if (result.error) {
    throw new Error(`failed to spawn oo skills install: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`oo skills install --out-dir failed (code ${result.status}): ${result.stderr || result.stdout}`)
  }

  assertSkillsExported(result.stdout, outDir)
  return outDir
}

/** 校验 oo skills install --json 的导出结果：4 个内置 skill 全部 exported、无失败。 */
function assertSkillsExported(stdout: string, outDir: string): void {
  let parsed: SkillsInstallExport
  try {
    parsed = JSON.parse(stdout) as SkillsInstallExport
  } catch (cause) {
    throw new Error(`oo skills install returned non-JSON output: ${cause instanceof Error ? cause.message : cause}`)
  }

  const exportedIds = new Set(
    (parsed.skills ?? []).filter((skill) => skill.status === "exported" && skill.skillId).map((skill) => skill.skillId),
  )
  const missing = bundledSkillIds.filter((skillId) => !exportedIds.has(skillId))
  if (missing.length > 0 || (parsed.summary?.failed ?? 0) > 0) {
    throw new Error(`bundled skill export incomplete in ${outDir}: missing [${missing.join(", ")}]`)
  }
}
