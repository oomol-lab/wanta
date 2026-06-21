import type { ManagedSkillKind } from "./common.ts"
import type { InstalledSkill } from "./types.ts"

import path from "node:path"
import { resolveOoStoreDirectory } from "../oo-store-paths.ts"

export function resolveSharedAgentSkillRoot(homeDirectory: string): string {
  if (!path.isAbsolute(homeDirectory)) {
    throw new Error("homeDirectory must be an absolute path")
  }

  return path.join(homeDirectory, ".agents", "skills")
}

function resolveCanonicalRootPath(kind: ManagedSkillKind | undefined): string | undefined {
  if (kind === "registry") {
    return path.join(resolveOoStoreDirectory(), "skills", "registry")
  }

  return undefined
}

export function resolveCanonicalSourcePath(
  skill: Pick<InstalledSkill, "agent" | "metadata" | "name" | "path">,
): string {
  const rootPath = resolveCanonicalRootPath(skill.metadata.kind)

  if (!rootPath) {
    return path.resolve(skill.path)
  }

  if (skill.name.includes("/") || skill.name.includes("\\") || skill.name === "." || skill.name === "..") {
    throw new Error(`Invalid skill name: ${skill.name}`)
  }

  return path.join(rootPath, skill.name)
}
