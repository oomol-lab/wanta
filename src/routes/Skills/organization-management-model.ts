import type {
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationProviderOption,
  OrganizationUserSearchResult,
  OrganizationUserSummary,
} from "../../../electron/organizations/common.ts"
import type { RuntimeSkillRemoveTarget } from "./skill-route-model.ts"

export { organizationCanManage, organizationRole } from "../../lib/organization-permissions.ts"
import { parseProviderGrants } from "./organization-provider-access.ts"

export type OrganizationRole = "creator" | "member"
export type BusyAction =
  | "add"
  | "addSkillBatch"
  | "create"
  | "disableMembers"
  | "enableMembers"
  | "installSkillBatch"
  | "saveProviderAccess"
  | "updateOrganization"
  | `addSkill:${string}`
  | `installSkill:${string}`
  | `remove:${string}`
  | `removeSkill:${string}`
  | `revokeProviderAccess:${string}`
export type LoadStatus = "idle" | "loading" | "ready" | "error"
export type ProviderAccessMode = "create" | "edit"

export interface LoadState<T> {
  data: T
  error: string | null
  errorStatus: number | null
  status: LoadStatus
}

export async function refreshAfterCommittedOrganizationMutation(
  refresh: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  try {
    await refresh()
    return true
  } catch (error) {
    onFailure(error)
    return false
  }
}

export function organizationOperationTargetsCurrentOrganization(
  targetOrganizationId: string,
  currentOrganizationId: string | null,
): boolean {
  return Boolean(currentOrganizationId) && targetOrganizationId === currentOrganizationId
}

export interface MemberView extends OrganizationMember {
  avatar: string
  displayName: string
  fallback: string
  secondaryLabel: string
}

export interface ProviderGrantView {
  allProviders: boolean
  member: MemberView | null
  providers: OrganizationProviderOption[]
  userId: string
}

export interface ProviderAccessForm {
  allProviders: boolean
  mode: ProviderAccessMode
  open: boolean
  providers: string[]
  userId: string
}

export interface MemberSearchState {
  error: string | null
  items: Array<OrganizationUserSearchResult & { displayName: string; fallback: string; userId: string }>
  loading: boolean
  query: string
}

export interface AccountSummaryLike {
  avatarUrl?: string
  id: string
  name: string
}

export interface OrganizationSkillPackageItem {
  packageName: string
}

export interface OrganizationSkillLinkInput {
  packageName: string
  skillName: string
  version: string
}

export interface OrganizationSkillBulkPlan<T extends OrganizationSkillPackageItem> {
  linkable: T[]
  linked: T[]
}

export const maxOrganizationNameLength = 100
export const minimumMemberSearchLength = 2

const organizationNamePattern = /^[A-Za-z0-9._'-]+$/

export const initialProviderAccessForm: ProviderAccessForm = {
  allProviders: false,
  mode: "create",
  open: false,
  providers: [],
  userId: "",
}

export function loadState<T>(data: T): LoadState<T> {
  return { data, error: null, errorStatus: null, status: "idle" }
}

export function loadingState<T>(current: LoadState<T>): LoadState<T> {
  return { ...current, error: null, errorStatus: null, status: "loading" }
}

export function errorState<T>(current: LoadState<T>, error: unknown): LoadState<T> {
  return { ...current, error: errorMessage(error), errorStatus: httpErrorStatus(error), status: "error" }
}

export function readyState<T>(data: T): LoadState<T> {
  return { data, error: null, errorStatus: null, status: "ready" }
}

function httpErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null
  }
  return typeof error.status === "number" && Number.isFinite(error.status) ? error.status : null
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isConflictError(error: unknown): boolean {
  return errorMessage(error).includes("HTTP 409")
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function filterOrganizationProviderOptions(
  options: readonly OrganizationProviderOption[],
  query: string,
): OrganizationProviderOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return [...options]
  }
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(normalizedQuery) || option.service.toLowerCase().includes(normalizedQuery),
  )
}

export function organizationSkillPackageKey(packageName: string): string {
  return packageName.trim().toLowerCase()
}

export function createOrganizationSkillPackageSet(
  skills: readonly OrganizationSkillPackageItem[],
): ReadonlySet<string> {
  return new Set(
    skills
      .map((skill) => organizationSkillPackageKey(skill.packageName))
      .filter((packageName) => packageName.length > 0),
  )
}

export function organizationSkillPackageLinked(linkedPackageKeys: ReadonlySet<string>, packageName: string): boolean {
  const key = organizationSkillPackageKey(packageName)
  return Boolean(key) && linkedPackageKeys.has(key)
}

export function organizationSkillIdentityKey(packageName: string, skillName: string): string {
  const normalizedPackageName = organizationSkillPackageKey(packageName)
  const normalizedSkillName = skillName.trim().toLowerCase()
  return normalizedPackageName && normalizedSkillName ? `${normalizedPackageName}\u0000${normalizedSkillName}` : ""
}

export function runtimeSkillRemoveBusyKey(target: RuntimeSkillRemoveTarget): BusyAction {
  return `removeSkill:${target.packageName ?? ""}:${target.skillName}`
}

export function planProviderSkillRecommendationBulkLinks<T extends { packageName: string; skillId: string }>(
  items: readonly T[],
  linkedSkills: readonly OrganizationSkillPackageItem[],
): OrganizationSkillBulkPlan<T> {
  const linkedPackageKeys = createOrganizationSkillPackageSet(linkedSkills)
  const seenPackageKeys = new Set<string>()
  const linkable: T[] = []
  const linked: T[] = []

  for (const item of items) {
    const packageKey = organizationSkillPackageKey(item.packageName)
    if (!packageKey || seenPackageKeys.has(packageKey)) {
      continue
    }
    seenPackageKeys.add(packageKey)
    if (linkedPackageKeys.has(packageKey)) {
      linked.push(item)
    } else {
      linkable.push(item)
    }
  }

  return { linkable, linked }
}

export function userFallback(value: string): string {
  return value.trim().slice(0, 2).toLocaleUpperCase() || "U"
}

export function shortUserId(userId: string): string {
  return userId.length > 16 ? `${userId.slice(0, 8)}...${userId.slice(-6)}` : userId
}

export function organizationNameValidation(name: string): "empty" | "invalid" | "too-long" | "valid" {
  if (!name) {
    return "empty"
  }
  if (name.length > maxOrganizationNameLength) {
    return "too-long"
  }
  if (!organizationNamePattern.test(name)) {
    return "invalid"
  }
  return "valid"
}

export function buildMemberViews(
  members: OrganizationMember[],
  summaries: Record<string, OrganizationUserSummary>,
): MemberView[] {
  return members.map((member) => {
    const summary = summaries[member.user_id]
    const displayName = summary ? summary.nickname || summary.username || member.user_id : member.user_id
    return {
      ...member,
      avatar: summary?.url ?? "",
      displayName,
      fallback: userFallback(displayName),
      secondaryLabel: summary ? shortUserId(member.user_id) : member.user_id,
    }
  })
}

export function buildOrganizationMemberViews({
  account,
  accountRole,
  members,
  organization,
  summaries,
}: {
  account?: AccountSummaryLike
  accountRole?: OrganizationRole | null
  members: OrganizationMember[]
  organization: Organization | null
  summaries: Record<string, OrganizationUserSummary>
}): MemberView[] {
  const nextMembers = [...members]
  const fallbackSummaries: Record<string, OrganizationUserSummary> = { ...summaries }

  const upsertMember = (userId: string | undefined, role: OrganizationRole): void => {
    if (!userId) {
      return
    }
    const existingIndex = nextMembers.findIndex((member) => member.user_id === userId)
    if (existingIndex >= 0) {
      if (role === "creator" && nextMembers[existingIndex]?.role !== "creator") {
        nextMembers[existingIndex] = { ...nextMembers[existingIndex], role: "creator" }
      }
      return
    }
    nextMembers.push({ role, user_id: userId })
  }

  if (account) {
    const existingSummary = fallbackSummaries[account.id]
    fallbackSummaries[account.id] = {
      ...(account.avatarUrl ? { url: account.avatarUrl } : {}),
      ...existingSummary,
      nickname: existingSummary?.nickname ?? account.name,
      username: existingSummary?.username ?? account.name,
    }
  }

  upsertMember(organization?.creator_user_id, "creator")
  if (account && organization) {
    upsertMember(account.id, accountRole ?? organization.role ?? "member")
  }

  return buildMemberViews(nextMembers, fallbackSummaries)
}

export function buildGrantViews(
  appAccess: OrganizationAppAccess | null,
  members: MemberView[],
  providerOptions: OrganizationProviderOption[],
): { error: string | null; grants: ProviderGrantView[] } {
  if (!appAccess) {
    return { error: null, grants: [] }
  }

  const parsed = parseProviderGrants(appAccess)
  if (!parsed.ok) {
    return { error: parsed.error.message, grants: [] }
  }

  const labelByService = new Map(providerOptions.map((provider) => [provider.service, provider.label]))
  const memberByUserId = new Map(members.map((member) => [member.user_id, member]))
  return {
    error: null,
    grants: parsed.grants.map((grant) => ({
      allProviders: grant.allProviders,
      member: memberByUserId.get(grant.userId) ?? null,
      providers: grant.providers.map((service) => ({ service, label: labelByService.get(service) ?? service })),
      userId: grant.userId,
    })),
  }
}

export function providerOptionsWithSelected(
  options: OrganizationProviderOption[],
  selectedProviders: string[],
): OrganizationProviderOption[] {
  const seen = new Set(options.map((option) => option.service))
  const unknown = selectedProviders
    .filter((service) => !seen.has(service))
    .map((service) => ({ service, label: service }))
  return [...options, ...unknown].sort((left, right) => left.label.localeCompare(right.label))
}
