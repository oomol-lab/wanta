import type { PublicSkillPackage } from "../../electron/skills/common.ts"

import { orgControlBaseUrl, packageAssetsBaseUrl, searchBaseUrl } from "@/lib/domain"
import { oomolFetch, oomolFetchJson } from "@/lib/oomol-http"

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

export interface UpdateOrganizationSkillInput {
  enabled?: boolean
  order?: number
  version?: string
  versionPolicy?: OrganizationSkillVersionPolicy
}

export interface ReorderOrganizationSkillInput {
  id: string
  order: number
}

export interface ResolvedOrganizationSkill {
  archiveUrl?: string
  assetBaseUrl?: string
  checksum?: string
  configId: string
  packageName: string
  skillName: string
  skillPath?: string
  version: string
}

export interface ResolvedOrganizationSkills {
  skills: ResolvedOrganizationSkill[]
  updatedAt: string
}

interface RegistrySkillInfo {
  description?: string
  icon?: string
  name?: string
  path?: string
  title?: string
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
  return value === "1" || value === "true"
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
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

function normalizeVersionPolicy(value: unknown): OrganizationSkillVersionPolicy {
  return value === "latest" ? "latest" : "pinned"
}

function normalizeVisibility(value: unknown): OrganizationSkillVisibility {
  return value === "private" || value === "public" ? value : "unknown"
}

export function normalizeOrganizationSkillConfigItem(value: unknown): OrganizationSkillConfigItem | undefined {
  const item = asPlainObject(value)
  if (!item) {
    return undefined
  }

  const packageName = asString(item["packageName"] ?? item["package_name"])
  const skillName = asString(item["skillName"] ?? item["skill_name"] ?? item["name"])
  if (!packageName || !skillName) {
    return undefined
  }

  const version = asString(item["version"]) ?? "latest"
  return {
    ...(asString(item["createdAt"] ?? item["created_at"])
      ? { createdAt: asString(item["createdAt"] ?? item["created_at"]) }
      : {}),
    ...(asString(item["createdBy"] ?? item["created_by"])
      ? { createdBy: asString(item["createdBy"] ?? item["created_by"]) }
      : {}),
    ...(asString(item["description"]) ? { description: asString(item["description"]) } : {}),
    displayName: asString(item["displayName"] ?? item["display_name"] ?? item["title"]) ?? skillName,
    enabled: asBoolean(item["enabled"], true),
    ...(asString(item["icon"]) ? { icon: asString(item["icon"]) } : {}),
    id: asString(item["id"]) ?? `${packageName}:${skillName}`,
    order: asNumber(item["order"], 0),
    packageName,
    skillName,
    ...(asString(item["updatedAt"] ?? item["updated_at"])
      ? { updatedAt: asString(item["updatedAt"] ?? item["updated_at"]) }
      : {}),
    version,
    versionPolicy: normalizeVersionPolicy(item["versionPolicy"] ?? item["version_policy"]),
    visibility: normalizeVisibility(item["visibility"]),
  }
}

export function normalizeOrganizationSkillConfig(value: unknown): OrganizationSkillConfig {
  const payload = asPlainObject(value)
  const rawSkills = Array.isArray(payload?.["skills"]) ? payload["skills"] : []
  return {
    skills: rawSkills
      .map(normalizeOrganizationSkillConfigItem)
      .filter((item): item is OrganizationSkillConfigItem => Boolean(item))
      .sort(compareOrganizationSkills),
    updatedAt: asString(payload?.["updatedAt"] ?? payload?.["updated_at"]) ?? new Date().toISOString(),
  }
}

function compareOrganizationSkills(left: OrganizationSkillConfigItem, right: OrganizationSkillConfigItem): number {
  if (left.order !== right.order) {
    return left.order - right.order
  }
  return left.displayName.localeCompare(right.displayName)
}

export function organizationSkillMentionId(
  skill: Pick<OrganizationSkillConfigItem, "id" | "packageName" | "skillName">,
): string {
  return `organization:${skill.id || `${skill.packageName}:${skill.skillName}`}`
}

export async function listOrganizationSkills(orgId: string): Promise<OrganizationSkillConfig> {
  const response = await oomolFetchJson<unknown>(
    new URL(`/v1/organizations/${encodePath(orgId)}/skills`, orgControlBaseUrl),
    { timeoutMs: organizationSkillRequestTimeoutMs },
  )
  return normalizeOrganizationSkillConfig(response)
}

export async function addOrganizationSkill(
  orgId: string,
  input: AddOrganizationSkillInput,
): Promise<OrganizationSkillConfigItem> {
  const response = await oomolFetchJson<unknown>(
    new URL(`/v1/organizations/${encodePath(orgId)}/skills`, orgControlBaseUrl),
    {
      body: JSON.stringify({
        enabled: input.enabled ?? true,
        packageName: input.packageName.trim(),
        skillName: input.skillName.trim(),
        version: input.version?.trim() || "latest",
        versionPolicy: input.versionPolicy ?? "pinned",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      timeoutMs: organizationSkillRequestTimeoutMs,
    },
  )
  const normalized = normalizeOrganizationSkillConfigItem(response)
  if (!normalized) {
    throw new Error("Organization Skill response is invalid.")
  }
  return normalized
}

export async function updateOrganizationSkill(
  orgId: string,
  configId: string,
  input: UpdateOrganizationSkillInput,
): Promise<OrganizationSkillConfigItem> {
  const response = await oomolFetchJson<unknown>(
    new URL(`/v1/organizations/${encodePath(orgId)}/skills/${encodePath(configId)}`, orgControlBaseUrl),
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
      timeoutMs: organizationSkillRequestTimeoutMs,
    },
  )
  const normalized = normalizeOrganizationSkillConfigItem(response)
  if (!normalized) {
    throw new Error("Organization Skill response is invalid.")
  }
  return normalized
}

export async function removeOrganizationSkill(orgId: string, configId: string): Promise<void> {
  await oomolFetchJson<void>(
    new URL(`/v1/organizations/${encodePath(orgId)}/skills/${encodePath(configId)}`, orgControlBaseUrl),
    {
      method: "DELETE",
      timeoutMs: organizationSkillRequestTimeoutMs,
    },
  )
}

export async function reorderOrganizationSkills(
  orgId: string,
  items: ReorderOrganizationSkillInput[],
): Promise<OrganizationSkillConfig> {
  const response = await oomolFetchJson<unknown>(
    new URL(`/v1/organizations/${encodePath(orgId)}/skills/order`, orgControlBaseUrl),
    {
      body: JSON.stringify({ items }),
      headers: { "content-type": "application/json" },
      method: "PUT",
      timeoutMs: organizationSkillRequestTimeoutMs,
    },
  )
  return normalizeOrganizationSkillConfig(response)
}

export function normalizeResolvedOrganizationSkills(value: unknown): ResolvedOrganizationSkills {
  const payload = asPlainObject(value)
  const rawSkills = Array.isArray(payload?.["skills"]) ? payload["skills"] : []
  return {
    skills: rawSkills
      .map((entry): ResolvedOrganizationSkill | undefined => {
        const item = asPlainObject(entry)
        const configId = asString(item?.["configId"] ?? item?.["config_id"])
        const packageName = asString(item?.["packageName"] ?? item?.["package_name"])
        const skillName = asString(item?.["skillName"] ?? item?.["skill_name"])
        const version = asString(item?.["version"])
        if (!configId || !packageName || !skillName || !version) {
          return undefined
        }
        return {
          ...(asString(item?.["archiveUrl"] ?? item?.["archive_url"])
            ? { archiveUrl: asString(item?.["archiveUrl"] ?? item?.["archive_url"]) }
            : {}),
          ...(asString(item?.["assetBaseUrl"] ?? item?.["asset_base_url"])
            ? { assetBaseUrl: asString(item?.["assetBaseUrl"] ?? item?.["asset_base_url"]) }
            : {}),
          ...(asString(item?.["checksum"]) ? { checksum: asString(item?.["checksum"]) } : {}),
          configId,
          packageName,
          skillName,
          ...(asString(item?.["skillPath"] ?? item?.["skill_path"])
            ? { skillPath: asString(item?.["skillPath"] ?? item?.["skill_path"]) }
            : {}),
          version,
        }
      })
      .filter((item): item is ResolvedOrganizationSkill => Boolean(item)),
    updatedAt: asString(payload?.["updatedAt"] ?? payload?.["updated_at"]) ?? new Date().toISOString(),
  }
}

export async function listResolvedOrganizationSkills(orgId: string): Promise<ResolvedOrganizationSkills> {
  const response = await oomolFetchJson<unknown>(
    new URL(`/v1/organizations/${encodePath(orgId)}/skills/resolved`, orgControlBaseUrl),
    { timeoutMs: organizationSkillRequestTimeoutMs },
  )
  return normalizeResolvedOrganizationSkills(response)
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
    `/packages/${packageName}/${version}/files/package/skills/${encodeURIComponent(skillName)}/SKILL.md`,
    packageAssetsBaseUrl,
  )
  const response = await oomolFetch(url, {
    headers: { Accept: "text/plain, */*" },
    timeoutMs: organizationSkillRequestTimeoutMs,
  })
  if (!response.ok) {
    throw new Error(`Skill Markdown request failed with status ${response.status}.`)
  }
  return response.text()
}
