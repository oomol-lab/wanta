import { apiBaseUrl, consoleBaseUrl, registryBaseUrl } from "@/lib/domain"
import { oomolFetchJson } from "@/lib/oomol-http"

export interface SkillPackageMaintainer {
  id: string
  name: string
  url?: string
}

export interface SkillPackageMaintainerDetail {
  maintainers: SkillPackageMaintainer[]
}

interface RawSkillPackageMaintainer {
  id?: unknown
  name?: unknown
  url?: unknown
}

interface RawSkillPackageDetail {
  maintainers?: unknown
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function encodeSkillPackagePath(packageName: string): string {
  return packageName
    .trim()
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%40", "@"))
    .join("/")
}

function normalizeMaintainer(value: unknown): SkillPackageMaintainer | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }
  const raw = value as RawSkillPackageMaintainer
  const id = asText(raw.id)
  const name = asText(raw.name)
  if (!id || !name) {
    return undefined
  }
  return {
    id,
    name,
    ...(asText(raw.url) ? { url: asText(raw.url) } : {}),
  }
}

function normalizeMaintainers(value: unknown): SkillPackageMaintainer[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(normalizeMaintainer)
    .filter((maintainer): maintainer is SkillPackageMaintainer => Boolean(maintainer))
}

export async function getSkillPackageMaintainerDetail({
  packageName,
  signal,
  version = "latest",
}: {
  packageName: string
  signal?: AbortSignal
  version?: string
}): Promise<SkillPackageMaintainerDetail> {
  const normalizedPackageName = packageName.trim()
  if (!normalizedPackageName) {
    throw new Error("Skill package name is required.")
  }
  const url = new URL(
    `/-/oomol/detail/${encodeSkillPackagePath(normalizedPackageName)}/${encodeURIComponent(version.trim() || "latest")}`,
    registryBaseUrl,
  )
  const detail = await oomolFetchJson<RawSkillPackageDetail>(url, { signal })
  return { maintainers: normalizeMaintainers(detail?.maintainers) }
}

export async function inviteSkillPackageMaintainer({
  packageName,
  username,
}: {
  packageName: string
  username: string
}): Promise<void> {
  const normalizedPackageName = packageName.trim()
  const normalizedUsername = username.trim()
  if (!normalizedPackageName || !normalizedUsername) {
    throw new Error("Skill package name and username are required.")
  }
  await oomolFetchJson<void>(
    new URL(
      `/v1/users/packages/${encodeSkillPackagePath(normalizedPackageName)}/maintainers/${encodeURIComponent(normalizedUsername)}/invitation`,
      apiBaseUrl,
    ),
    { method: "POST" },
  )
}

export function getSkillMaintainerInvitationUrl({
  fromUsername,
  packageName,
}: {
  fromUsername: string
  packageName: string
}): string {
  const url = new URL("/skill-maintainer-invitation", consoleBaseUrl)
  url.searchParams.set("package", packageName.trim())
  url.searchParams.set("from", fromUsername.trim())
  return url.toString()
}
