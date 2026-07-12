import { access, realpath } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic } from "../diagnostics-log.ts"

/** 仅允许访问 inventory 明确登记的 skill 根及其真实子路径，realpath 防止符号链接越界。 */
export async function resolveAllowedSkillPath(
  requestPath: string,
  allowedPaths: Iterable<string | undefined>,
): Promise<string> {
  const canonicalRequestPath = await realpath(path.resolve(requestPath))
  for (const allowedPath of allowedPaths) {
    if (!allowedPath) {
      continue
    }
    const resolvedAllowedPath = path.resolve(allowedPath)
    const canonicalAllowedPath = await realpath(resolvedAllowedPath).catch((error: unknown) => {
      logDiagnostic("skills", "failed to resolve allowed skill path", { error, path: resolvedAllowedPath }, "warn")
      return undefined
    })
    if (
      canonicalAllowedPath &&
      (canonicalRequestPath === canonicalAllowedPath ||
        canonicalRequestPath.startsWith(`${canonicalAllowedPath}${path.sep}`))
    ) {
      await access(canonicalRequestPath)
      return canonicalRequestPath
    }
  }
  throw new Error("Skill path is not allowed.")
}

export async function resolveAllowedSkillDocumentPath(
  requestPath: string,
  allowedPaths: Iterable<string | undefined>,
): Promise<string> {
  const skillPath = await resolveAllowedSkillPath(requestPath, allowedPaths)
  const skillFilePath = path.join(skillPath, "SKILL.md")
  await access(skillFilePath)
  return skillFilePath
}
