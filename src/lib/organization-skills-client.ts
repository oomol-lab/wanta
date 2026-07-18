import { registryBaseUrl } from "@/lib/domain"
import { oomolFetchJson } from "@/lib/oomol-http"
import { resolvePackageAssetIconSource } from "@/lib/skill-icon-assets.ts"

export type OrganizationSkillVersionPolicy = "latest" | "pinned"
export type OrganizationSkillVisibility = "private" | "public" | "unknown"

export interface OrganizationSkillConfigItem {
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
  versionPolicy: OrganizationSkillVersionPolicy
  visibility: OrganizationSkillVisibility
}

export interface OrganizationSkillConfig {
  skills: OrganizationSkillConfigItem[]
  updatedAt: string
}

export interface AddOrganizationSkillInput {
  enabled?: boolean
  packageName: string
  skillName: string
  version?: string
  versionPolicy?: OrganizationSkillVersionPolicy
}

interface OrganizationSkillPackageRawItem {
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

interface OrganizationSkillPackageResponse {
  data?: unknown
}

const organizationSkillRequestTimeoutMs = 15_000
const organizationSkillsApiFlag = "VITE_WANTA_ORGANIZATION_SKILLS_API"

export function organizationSkillsApiEnabled(): boolean {
  const value = (import.meta.env as Record<string, string | undefined>)[organizationSkillsApiFlag]?.trim().toLowerCase()
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

function normalizeVisibility(value: unknown): OrganizationSkillVisibility {
  return value === "private" || value === "public" ? value : "unknown"
}

function compareOrganizationSkills(left: OrganizationSkillConfigItem, right: OrganizationSkillConfigItem): number {
  if (left.order !== right.order) {
    return left.order - right.order
  }
  return left.displayName.localeCompare(right.displayName)
}

export function normalizeOrganizationSkillPackages(value: unknown): OrganizationSkillConfig {
  const payload = asPlainObject(value)
  const rawPackages = Array.isArray(payload?.["data"]) ? payload["data"] : []
  return {
    skills: rawPackages
      .flatMap((entry, packageIndex) => normalizeOrganizationSkillPackage(entry, packageIndex))
      .sort(compareOrganizationSkills),
    updatedAt: new Date().toISOString(),
  }
}

function normalizeOrganizationSkillPackage(value: unknown, packageIndex: number): OrganizationSkillConfigItem[] {
  const raw = asPlainObject(value) as OrganizationSkillPackageRawItem | undefined
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
    .map((skillValue, skillIndex): OrganizationSkillConfigItem | undefined => {
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
    .filter((item): item is OrganizationSkillConfigItem => Boolean(item))
}

function normalizePackageVisibility(raw: Pick<OrganizationSkillPackageRawItem, "isPrivate" | "visibility">) {
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

function createOrganizationSkillItemFromInput(input: AddOrganizationSkillInput): OrganizationSkillConfigItem {
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

function organizationSkillPackageUrl(packageName: string, orgId: string): URL {
  return new URL(
    `/-/oomol/packages/${encodePackagePath(packageName)}/orgs/${encodeURIComponent(orgId.trim())}`,
    registryBaseUrl,
  )
}

export function organizationSkillMentionId(
  skill: Pick<OrganizationSkillConfigItem, "id" | "packageName" | "skillName">,
): string {
  return `organization:${skill.id || `${skill.packageName}:${skill.skillName}`}`
}

export async function listOrganizationSkills(orgId: string): Promise<OrganizationSkillConfig> {
  const response = await oomolFetchJson<OrganizationSkillPackageResponse>(
    new URL(`/-/oomol/orgs/${encodeURIComponent(orgId.trim())}/package-infos`, registryBaseUrl),
    { timeoutMs: organizationSkillRequestTimeoutMs },
  )
  return normalizeOrganizationSkillPackages(response)
}

export async function addOrganizationSkill(
  orgId: string,
  input: AddOrganizationSkillInput,
): Promise<OrganizationSkillConfigItem> {
  // 当前 registry 接口关联的是 package；skillName 用于本地乐观项，刷新后以后端 package-infos 为准。
  await oomolFetchJson<void>(organizationSkillPackageUrl(input.packageName, orgId), {
    method: "PUT",
    timeoutMs: organizationSkillRequestTimeoutMs,
  })
  return createOrganizationSkillItemFromInput(input)
}

export async function removeOrganizationSkill(orgId: string, packageName: string): Promise<void> {
  await oomolFetchJson<void>(organizationSkillPackageUrl(packageName, orgId), {
    method: "DELETE",
    timeoutMs: organizationSkillRequestTimeoutMs,
  })
}
