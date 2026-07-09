import type { PublicSkillPackage } from "../../electron/skills/common.ts"

import { packageAssetsBaseUrl, registryBaseUrl, searchBaseUrl } from "@/lib/domain"
import { OomolAuthRequiredError, OomolHttpError, oomolFetch, oomolFetchJson } from "@/lib/oomol-http"
import { resolvePackageAssetIconSource } from "@/lib/skill-icon-assets.ts"

export type OrganizationSkillVersionPolicy = "latest" | "pinned"
export type OrganizationSkillVisibility = "private" | "public" | "unknown"

export interface OrganizationSkillConfigItem {
  createdAt?: string
  createdBy?: string
  description?: string
  displayName: string
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
  packageName: string
  skillName: string
  version?: string
  versionPolicy?: OrganizationSkillVersionPolicy
}

interface RegistrySkillInfo {
  description?: string
  icon?: string
  name?: string
  path?: string
  title?: string
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

interface MySkillPackageRawItem {
  description?: string
  displayName?: string
  downloadCount?: number
  extra?: Record<string, string>
  icon?: string
  id?: string
  maintainers?: Array<{ id?: string; name?: string; url?: string }>
  name?: string
  repositoryUrl?: string
  skills?: RegistrySkillInfo[]
  updateTime?: number
  version?: string
  visibility?: OrganizationSkillVisibility
}

interface MySkillPackagesResponse {
  data?: MySkillPackageRawItem[]
  next?: string | null
}

const organizationSkillRequestTimeoutMs = 15_000
const mySkillsPageSize = 100
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

function encodePath(value: string): string {
  return encodeURIComponent(value.trim())
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
  await oomolFetchJson<void>(organizationSkillPackageUrl(input.packageName, orgId), {
    method: "PUT",
    timeoutMs: organizationSkillRequestTimeoutMs,
  })
  return createOrganizationSkillItemFromInput(input)
}

export async function removeOrganizationSkill(orgId: string, configId: string): Promise<void> {
  await oomolFetchJson<void>(organizationSkillPackageUrl(configId, orgId), {
    method: "DELETE",
    timeoutMs: organizationSkillRequestTimeoutMs,
  })
}

export async function listMyPublishedSkills(options: { lang?: "en" | "zh-CN"; next?: string } = {}): Promise<{
  items: PublicSkillPackage[]
  next: string | null
  updatedAt: string
}> {
  const url = new URL("/v1/packages/-/my-skills", searchBaseUrl)
  url.searchParams.set("size", String(mySkillsPageSize))
  if (options.lang) {
    url.searchParams.set("lang", options.lang)
  }
  if (options.next?.trim()) {
    url.searchParams.set("next", options.next.trim())
  }
  const payload = await oomolFetchJson<MySkillPackagesResponse>(url, { timeoutMs: organizationSkillRequestTimeoutMs })
  return {
    items: (payload.data ?? [])
      .map(normalizeMySkillPackage)
      .filter((item): item is PublicSkillPackage => Boolean(item)),
    next: payload.next ?? null,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeMySkillPackage(raw: MySkillPackageRawItem): PublicSkillPackage | undefined {
  const name = raw.name?.trim()
  if (!name) {
    return undefined
  }
  const version = raw.version || raw.extra?.latestVersion || "latest"
  return {
    description: raw.description,
    displayName: raw.displayName || name,
    downloadCount: raw.downloadCount,
    icon: raw.icon,
    id: raw.id || `${name}@${version}`,
    isTemplate: false,
    maintainers: (raw.maintainers ?? []).map((maintainer) => ({
      ...(maintainer.id ? { id: maintainer.id } : {}),
      name: maintainer.name || name,
      ...(maintainer.url ? { url: maintainer.url } : {}),
    })),
    name,
    skills: (raw.skills ?? [])
      .map((skill) => {
        const skillName = skill.name || skill.path
        return skillName
          ? {
              ...(skill.description ? { description: skill.description } : {}),
              name: skillName,
              title: skill.title || skill.name || skillName,
            }
          : undefined
      })
      .filter((skill): skill is PublicSkillPackage["skills"][number] => Boolean(skill)),
    updateTime: raw.updateTime,
    version,
    visibility: normalizeVisibility(raw.visibility),
  }
}

export async function readSkillMarkdown(packageName: string, version: string, skillName: string): Promise<string> {
  const url = new URL(
    `/packages/${encodePath(packageName)}/${encodePath(version)}/files/package/skills/${encodePath(skillName)}/SKILL.md`,
    packageAssetsBaseUrl,
  )
  const response = await oomolFetch(url, {
    headers: { Accept: "text/plain, */*" },
    timeoutMs: organizationSkillRequestTimeoutMs,
  })
  if (response.status === 401) {
    throw new OomolAuthRequiredError()
  }
  if (!response.ok) {
    throw new OomolHttpError(`Skill Markdown request failed with status ${response.status}.`, response.status)
  }
  return response.text()
}
