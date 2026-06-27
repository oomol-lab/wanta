import type { ManagedSkillMetadata } from "./types.ts"

import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { resolveOoStoreDirectory } from "../oo-store-paths.ts"
import { metadataFileName } from "./constants.ts"
import { normalizeMetadata } from "./metadata.ts"

export interface RegistrySkillSourceRequest {
  cacheSkillStoreRoot: string
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
  includeCanonicalStore?: boolean
  packageName?: string
  platform?: NodeJS.Platform
  skillId: string
}

export function readCachedSkillSourceCandidates(cacheSkillStoreRoot: string, skillId: string): string[] {
  const normalizedSkillId = normalizeSkillDirectoryName(skillId)
  return [path.join(cacheSkillStoreRoot, "registry", normalizedSkillId)]
}

export function readRegistrySkillSourceCandidates(request: RegistrySkillSourceRequest): string[] {
  const candidates = readCachedSkillSourceCandidates(request.cacheSkillStoreRoot, request.skillId)

  if (request.includeCanonicalStore) {
    candidates.push(
      path.join(
        resolveOoStoreDirectory(request.env, request.platform, request.homeDirectory),
        "skills",
        "registry",
        normalizeSkillDirectoryName(request.skillId),
      ),
    )
  }

  return candidates
}

export async function resolveUsableRegistrySkillSourcePath(
  request: RegistrySkillSourceRequest,
): Promise<string | undefined> {
  const normalizedPackageName = request.packageName?.trim()

  for (const sourcePath of readRegistrySkillSourceCandidates(request)) {
    if (await isUsableRegistrySkillSourcePath(sourcePath, normalizedPackageName)) {
      return sourcePath
    }
  }

  return undefined
}

function normalizeSkillDirectoryName(skillId: string): string {
  const normalizedSkillId = skillId.trim()
  if (
    !normalizedSkillId ||
    normalizedSkillId.includes("/") ||
    normalizedSkillId.includes("\\") ||
    normalizedSkillId === "." ||
    normalizedSkillId === ".."
  ) {
    throw new Error(`Invalid Skill name: ${skillId}`)
  }

  return normalizedSkillId
}

async function isUsableRegistrySkillSourcePath(sourcePath: string, packageName: string | undefined): Promise<boolean> {
  const metadata = await readRegistrySkillSourceMetadata(sourcePath)
  const hasSkillDocument = await localPathExists(path.join(sourcePath, "SKILL.md"))

  if (!metadata && !hasSkillDocument) {
    return false
  }

  if (!packageName) {
    return true
  }

  return metadata?.packageName === packageName
}

async function readRegistrySkillSourceMetadata(sourcePath: string): Promise<ManagedSkillMetadata | undefined> {
  try {
    return normalizeMetadata(await readFile(path.join(sourcePath, metadataFileName), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

async function localPathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}
