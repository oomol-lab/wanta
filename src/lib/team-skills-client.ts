import { registryBaseUrl } from "@/lib/domain"
import { oomolFetchJson } from "@/lib/oomol-http"
import { resolvePackageAssetIconSource } from "@/lib/skill-icon-assets.ts"

export type TeamSkillVersionPolicy = "latest" | "pinned"
export type TeamSkillVisibility = "private" | "public" | "unknown"

export interface TeamSkillConfigItem {
  createdAt?: string
  createdBy?: string
  description?: string
  displayName: string
  enabled: boolean
  icon?: string
  id: string
  order: number
  packageName: string
  skillName: string
  updatedAt?: string
  version: string
  versionPolicy: TeamSkillVersionPolicy
  visibility: TeamSkillVisibility
}

export interface TeamSkillConfig {
  skills: TeamSkillConfigItem[]
  updatedAt: string
}

export interface AddTeamSkillInput {
  enabled?: boolean
  packageName: string
  skillName: string
  version?: string
  versionPolicy?: TeamSkillVersionPolicy
}

interface TeamSkillPackageRawItem {
  description?: unknown
  displayName?: unknown
  extra?: unknown
  icon?: unknown
  isPrivate?: unknown
  name?: unknown
  packageName?: unknown
  packageVersion?: unknown
  repository?: unknown
  repositoryUrl?: unknown
  skills?: unknown
  title?: unknown
  updateTime?: unknown
  version?: unknown
  visibility?: unknown
}

interface TeamSkillPackageResponse {
  data?: unknown
}

const teamSkillRequestTimeoutMs = 15_000
const teamSkillsApiFlag = "VITE_WANTA_TEAM_SKILLS_API"
const legacyTeamSkillsApiFlag = "VITE_WANTA_ORGANIZATION_SKILLS_API"

export function teamSkillsApiEnabled(): boolean {
  const env = import.meta.env as Record<string, string | undefined>
  const value = (env[teamSkillsApiFlag] ?? env[legacyTeamSkillsApiFlag])?.trim().toLowerCase()
  return value !== "0" && value !== "false" && value !== "off"
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function encodePackagePath(packageName: string): string {
  return packageName
    .trim()
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%40", "@"))
    .join("/")
}

function normalizeVisibility(value: unknown): TeamSkillVisibility {
  return value === "private" || value === "public" ? value : "unknown"
}

function compareTeamSkills(left: TeamSkillConfigItem, right: TeamSkillConfigItem): number {
  if (left.order !== right.order) {
    return left.order - right.order
  }
  return left.displayName.localeCompare(right.displayName)
}

export function normalizeTeamSkillPackages(value: unknown): TeamSkillConfig {
  const payload = asPlainObject(value)
  const rawPackages = Array.isArray(payload?.["data"]) ? payload["data"] : []
  return {
    skills: rawPackages
      .flatMap((entry, packageIndex) => normalizeTeamSkillPackage(entry, packageIndex))
      .sort(compareTeamSkills),
    updatedAt: new Date().toISOString(),
  }
}

function normalizeTeamSkillPackage(value: unknown, packageIndex: number): TeamSkillConfigItem[] {
  const raw = asPlainObject(value) as TeamSkillPackageRawItem | undefined
  if (!raw) {
    return []
  }

  const packageName = asString(raw.name) ?? asString(raw.packageName)
  if (!packageName) {
    return []
  }

  const extra = asPlainObject(raw.extra)
  const version =
    asString(raw.version) ?? asString(raw.packageVersion) ?? asString(extra?.["latestVersion"]) ?? "latest"
  const packageDescription = asString(raw.description)
  const visibility = normalizePackageVisibility(raw)
  const rawSkills = Array.isArray(raw.skills) ? raw.skills : []

  return rawSkills
    .map((skillValue, skillIndex): TeamSkillConfigItem | undefined => {
      const skill = asPlainObject(skillValue)
      const skillName = asString(skill?.["name"] ?? skill?.["path"])
      if (!skillName) {
        return undefined
      }

      const icon = resolveRegistrySkillIcon(asString(skill?.["icon"]) ?? asString(raw.icon), packageName, version)
      return {
        ...((asString(skill?.["description"]) ?? packageDescription)
          ? { description: asString(skill?.["description"]) ?? packageDescription }
          : {}),
        displayName: asString(skill?.["title"] ?? skill?.["displayName"]) ?? skillName,
        enabled: true,
        ...(icon ? { icon } : {}),
        id: `${packageName}:${skillName}`,
        order: packageIndex * 1000 + skillIndex,
        packageName,
        skillName,
        version,
        versionPolicy: "pinned",
        visibility,
      }
    })
    .filter((item): item is TeamSkillConfigItem => Boolean(item))
}

function normalizePackageVisibility(raw: Pick<TeamSkillPackageRawItem, "isPrivate" | "visibility">) {
  const visibility = normalizeVisibility(raw.visibility)
  if (visibility !== "unknown") {
    return visibility
  }
  if (raw.isPrivate === true) {
    return "private"
  }
  if (raw.isPrivate === false) {
    return "public"
  }
  return "unknown"
}

function resolveRegistrySkillIcon(icon: string | undefined, packageName: string, version: string): string | undefined {
  return resolvePackageAssetIconSource(icon, packageName, version)
}

function createTeamSkillItemFromInput(input: AddTeamSkillInput): TeamSkillConfigItem {
  const packageName = input.packageName.trim()
  const skillName = input.skillName.trim()
  const version = input.version?.trim() || "latest"
  return {
    displayName: skillName,
    enabled: input.enabled ?? true,
    id: `${packageName}:${skillName}`,
    order: 0,
    packageName,
    skillName,
    version,
    versionPolicy: input.versionPolicy ?? "pinned",
    visibility: "unknown",
  }
}

function teamSkillPackageUrl(packageName: string, teamId: string): URL {
  return new URL(
    `/-/oomol/packages/${encodePackagePath(packageName)}/orgs/${encodeURIComponent(teamId.trim())}`,
    registryBaseUrl,
  )
}

export function teamSkillMentionId(skill: Pick<TeamSkillConfigItem, "id" | "packageName" | "skillName">): string {
  return `team:${skill.id || `${skill.packageName}:${skill.skillName}`}`
}

export async function listTeamSkills(teamId: string): Promise<TeamSkillConfig> {
  const response = await oomolFetchJson<TeamSkillPackageResponse>(
    new URL(`/-/oomol/orgs/${encodeURIComponent(teamId.trim())}/package-infos`, registryBaseUrl),
    { timeoutMs: teamSkillRequestTimeoutMs },
  )
  return normalizeTeamSkillPackages(response)
}

export async function addTeamSkill(teamId: string, input: AddTeamSkillInput): Promise<TeamSkillConfigItem> {
  // 当前 registry 接口关联的是 package；skillName 用于本地乐观项，刷新后以后端 package-infos 为准。
  await oomolFetchJson<void>(teamSkillPackageUrl(input.packageName, teamId), {
    method: "PUT",
    timeoutMs: teamSkillRequestTimeoutMs,
  })
  return createTeamSkillItemFromInput(input)
}

export async function removeTeamSkill(teamId: string, packageName: string): Promise<void> {
  await oomolFetchJson<void>(teamSkillPackageUrl(packageName, teamId), {
    method: "DELETE",
    timeoutMs: teamSkillRequestTimeoutMs,
  })
}
