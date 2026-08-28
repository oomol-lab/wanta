// 静态内置 agent skill：构建期用 oo 二进制把 oo bundled skill 导出到 resources/skills/（gitignore），
// 再叠加 Wanta 的 tracked skill 补充规则（resources/skill-overrides/），并补入 Wanta 自带的只读工作流
// skills（resources/wanta-skills/）。
// 供 dev 与打包共用。运行时由 electron/agent/workspace.ts 拷进 OpenCode workspace 的 .opencode/skill/，
// 使 Wanta 自己的 agent 直接读到这些 skill——不再像旧 oo-cli 那样把 skill 释放到其他 AI agent 家目录。
//
// 与二进制下载同源：先经 downloadOoBinary() 确保当前平台 oo 就绪，再以 `oo skills install --out-dir` 导出。
// `--out-dir` 只写指定目录；仍隔离 OO_CONFIG/DATA/LOG 到临时目录并禁用 sync，避免污染开发机家目录。

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EXTERNAL_OO_OPERATIONS } from "../electron/agent/external/oo-capability-contract.ts"
import { downloadOoBinary, OO_CLI_VERSION } from "./oo-cli.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")

// 导出落地目录（gitignore）。dev 运行时与生产打包都以此为源；运行时路径解析见 electron/agent/binaries.ts。
export const bundledSkillsDir = path.join(repoRoot, "resources", "skills")
export const wantaSkillsDir = path.join(repoRoot, "resources", "wanta-skills")
export const skillOverridesDir = path.join(repoRoot, "resources", "skill-overrides")
export const skillLockDir = path.join(repoRoot, "resources", "skill-lock")

const ooBundledSkillIds = ["oo", "oo-find-skills", "oo-create-skill", "oo-publish-skill"] as const
export const wantaBundledSkillIds = ["browser", "wikigraph-knowledge"] as const

// 需内置到 Wanta agent workspace 的 skill；用于导出后的完整性校验（数量/缺失）。
export const bundledSkillIds = [...ooBundledSkillIds, ...wantaBundledSkillIds] as const

interface SkillsInstallExport {
  status?: string
  summary?: { requestedSkills?: number; exported?: number; failed?: number }
  skills?: Array<{ skillId?: string; status?: string }>
}

interface OoSkillLock {
  agentFormat: string
  files: Record<string, string>
  lockVersion: number
  ooCliVersion: string
  requiredOperations: string[]
}

export type BundledSkillsInstaller = (outDir: string) => Promise<string>

/**
 * 把 oo bundled skill 导出到 outDir（默认 resources/skills/）。幂等：先清空目录再导出，避免旧版本残留。
 * 返回导出目录绝对路径。导出失败或 oo skills 未全部导出则抛错。
 */
export async function exportBundledSkills(
  outDir: string = bundledSkillsDir,
  installOoSkills: BundledSkillsInstaller = installBundledOoSkills,
): Promise<string> {
  await rm(outDir, { force: true, recursive: true })
  await mkdir(outDir, { recursive: true })

  const stdout = await installOoSkills(outDir)
  assertSkillsExported(stdout, outDir)
  await applyBundledSkillOverrides(outDir)
  await Promise.all(
    wantaBundledSkillIds.map((skillId) =>
      cp(path.join(wantaSkillsDir, skillId), path.join(outDir, skillId), { recursive: true }),
    ),
  )
  await normalizeExportedSkillLineEndings(outDir)
  return outDir
}

async function installBundledOoSkills(outDir: string): Promise<string> {
  const ooBin = await downloadOoBinary()
  return installBundledOoSkillsFromBinary(ooBin, outDir)
}

export async function installBundledOoSkillsFromBinary(ooBin: string, outDir: string): Promise<string> {
  const storeDir = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-skill-export-store-"))
  try {
    const result = spawnSync(
      ooBin,
      ["skills", "install", `--out-dir=${outDir}`, "--agent-format=universal", "--json"],
      {
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
      },
    )

    if (result.error) {
      throw new Error(`failed to spawn oo skills install: ${result.error.message}`)
    }
    if (result.status !== 0) {
      throw new Error(`oo skills install --out-dir failed (code ${result.status}): ${result.stderr || result.stdout}`)
    }
    return result.stdout
  } finally {
    await rm(storeDir, { force: true, recursive: true })
  }
}

// Text files that end up in an exported Skill. Only these are rewritten to LF.
const exportedSkillTextExtensions = new Set([".md", ".yaml", ".yml", ".json", ".txt"])

/**
 * Rewrite CRLF to LF in every text file under outDir. `oo skills install` writes CRLF on Windows, and a
 * Windows checkout with core.autocrlf can do the same to the tracked overrides and Wanta skills, so this
 * runs last, after overrides are appended and Wanta skills are copied. That keeps resources/skill-lock/oo.json,
 * bin/oo-runtime-integrity.json and the runtime skill hashes (electron/skills/hash.ts) byte-exact across
 * platforms.
 */
export async function normalizeExportedSkillLineEndings(outDir: string): Promise<void> {
  const files = await readdirFilesRecursive(outDir)
  await Promise.all(
    files
      .filter((relativePath) => exportedSkillTextExtensions.has(path.extname(relativePath).toLowerCase()))
      .map(async (relativePath) => {
        const filePath = path.join(outDir, relativePath)
        const content = await readFile(filePath, "utf8")
        if (!content.includes("\r\n")) return
        await writeFile(filePath, content.replaceAll("\r\n", "\n"), "utf8")
      }),
  )
}

export async function applyBundledSkillOverrides(
  outDir: string,
  overridesDir: string = skillOverridesDir,
): Promise<void> {
  const overrideFiles = await readdirMarkdownFiles(overridesDir)
  await Promise.all(
    overrideFiles.map(async (filename) => {
      const skillId = path.basename(filename, ".md")
      const supplement = (await readFile(path.join(overridesDir, filename), "utf8")).trim()
      await appendFile(path.join(outDir, skillId, "SKILL.md"), `\n\n${supplement}\n`, "utf8")
    }),
  )
}

export async function verifyBundledOoSkillLock(
  skillsDir: string = bundledSkillsDir,
  lockPath: string = path.join(skillLockDir, "oo.json"),
): Promise<void> {
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as OoSkillLock
  if (lock.lockVersion !== 1 || lock.ooCliVersion !== OO_CLI_VERSION || lock.agentFormat !== "universal") {
    throw new Error(
      `bundled oo Skill lock targets ${lock.ooCliVersion}/${lock.agentFormat}, expected ${OO_CLI_VERSION}/universal`,
    )
  }
  const knownOperations = new Set<string>(EXTERNAL_OO_OPERATIONS.map((operation) => operation.id))
  const unknownOperations = lock.requiredOperations.filter((operation) => !knownOperations.has(operation))
  if (unknownOperations.length > 0) {
    throw new Error(`bundled oo Skill lock contains unknown operations: ${unknownOperations.join(", ")}`)
  }
  const actualFiles = (await readdirFilesRecursive(path.join(skillsDir, "oo"))).sort()
  const expectedFiles = Object.keys(lock.files).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `bundled oo Skill file set changed: expected [${expectedFiles.join(", ")}], got [${actualFiles.join(", ")}]`,
    )
  }
  for (const [relativePath, expected] of Object.entries(lock.files)) {
    const content = await readFile(path.join(skillsDir, "oo", relativePath))
    const actual = createHash("sha256").update(content).digest("hex")
    if (actual !== expected) {
      throw new Error(`bundled oo Skill lock changed at ${relativePath}: expected ${expected}, got ${actual}`)
    }
  }
}

export async function bundledOoSkillHashes(skillsDir: string = bundledSkillsDir): Promise<Record<string, string>> {
  const root = path.join(skillsDir, "oo")
  const files = (await readdirFilesRecursive(root)).sort()
  return Object.fromEntries(
    await Promise.all(
      files.map(async (relativePath) => {
        const content = await readFile(path.join(root, relativePath))
        return [relativePath, createHash("sha256").update(content).digest("hex")] as const
      }),
    ),
  )
}

async function readdirFilesRecursive(root: string, relativeDirectory = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) files.push(...(await readdirFilesRecursive(root, relativePath)))
    else if (entry.isFile()) files.push(relativePath.split(path.sep).join("/"))
  }
  return files
}

async function readdirMarkdownFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.endsWith(".md"))
}

/** 校验 oo skills install --json 的导出结果：oo 内置 skill 全部 exported、无失败。 */
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
  const missing = ooBundledSkillIds.filter((skillId) => !exportedIds.has(skillId))
  if (missing.length > 0 || (parsed.summary?.failed ?? 0) > 0) {
    throw new Error(`bundled skill export incomplete in ${outDir}: missing [${missing.join(", ")}]`)
  }
}
