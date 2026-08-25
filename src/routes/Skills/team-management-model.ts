import type {
  Team,
  TeamMember,
  TeamRole,
  TeamUserSearchResult,
  TeamUserSummary,
} from "../../../electron/teams/common.ts"
import type { RuntimeSkillRemoveTarget } from "./skill-route-model.ts"

export { teamCanManage, teamRole } from "../../lib/team-permissions.ts"

export type BusyAction =
  | "add"
  | "addSkillBatch"
  | "create"
  | "disableMembers"
  | "enableMembers"
  | "installSkillBatch"
  | "updateTeam"
  | `addSkill:${string}`
  | `installSkill:${string}`
  | `remove:${string}`
  | `removeSkill:${string}`
  | `updateMemberRole:${string}`
export type LoadStatus = "idle" | "loading" | "ready" | "error"

export interface LoadState<T> {
  data: T
  error: string | null
  errorStatus: number | null
  status: LoadStatus
}

export async function refreshAfterCommittedTeamMutation(
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

export function teamOperationTargetsCurrentTeam(targetTeamId: string, currentTeamId: string | null): boolean {
  return Boolean(currentTeamId) && targetTeamId === currentTeamId
}

export interface MemberView extends TeamMember {
  avatar: string
  displayName: string
  fallback: string
  secondaryLabel: string
}

export interface MemberSearchState {
  error: string | null
  items: Array<TeamUserSearchResult & { displayName: string; fallback: string; userId: string }>
  loading: boolean
  query: string
}

export interface AccountSummaryLike {
  avatarUrl?: string
  id: string
  name: string
}

export interface TeamSkillPackageItem {
  packageName: string
}

export interface TeamSkillLinkInput {
  packageName: string
  skillName: string
  version: string
}

export interface TeamSkillBulkPlan<T extends TeamSkillPackageItem> {
  linkable: T[]
  linked: T[]
}

export const maxTeamNameLength = 100
export const minimumMemberSearchLength = 2

const teamNamePattern = /^[A-Za-z0-9._'-]+$/

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

export function teamSkillPackageKey(packageName: string): string {
  return packageName.trim().toLowerCase()
}

export function createTeamSkillPackageSet(skills: readonly TeamSkillPackageItem[]): ReadonlySet<string> {
  return new Set(
    skills.map((skill) => teamSkillPackageKey(skill.packageName)).filter((packageName) => packageName.length > 0),
  )
}

export function teamSkillPackageLinked(linkedPackageKeys: ReadonlySet<string>, packageName: string): boolean {
  const key = teamSkillPackageKey(packageName)
  return Boolean(key) && linkedPackageKeys.has(key)
}

export function teamSkillIdentityKey(packageName: string, skillName: string): string {
  const normalizedPackageName = teamSkillPackageKey(packageName)
  const normalizedSkillName = skillName.trim().toLowerCase()
  return normalizedPackageName && normalizedSkillName ? `${normalizedPackageName}\u0000${normalizedSkillName}` : ""
}

export function runtimeSkillRemoveBusyKey(target: RuntimeSkillRemoveTarget): BusyAction {
  return `removeSkill:${target.packageName ?? ""}:${target.skillName}`
}

export function planProviderSkillRecommendationBulkLinks<T extends { packageName: string; skillId: string }>(
  items: readonly T[],
  linkedSkills: readonly TeamSkillPackageItem[],
): TeamSkillBulkPlan<T> {
  const linkedPackageKeys = createTeamSkillPackageSet(linkedSkills)
  const seenPackageKeys = new Set<string>()
  const linkable: T[] = []
  const linked: T[] = []

  for (const item of items) {
    const packageKey = teamSkillPackageKey(item.packageName)
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

export function teamNameValidation(name: string): "empty" | "invalid" | "too-long" | "valid" {
  if (!name) {
    return "empty"
  }
  if (name.length > maxTeamNameLength) {
    return "too-long"
  }
  if (!teamNamePattern.test(name)) {
    return "invalid"
  }
  return "valid"
}

export function buildMemberViews(members: TeamMember[], summaries: Record<string, TeamUserSummary>): MemberView[] {
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

export function buildTeamMemberViews({
  account,
  accountRole,
  members,
  team,
  summaries,
}: {
  account?: AccountSummaryLike
  accountRole?: TeamRole | null
  members: TeamMember[]
  team: Team | null
  summaries: Record<string, TeamUserSummary>
}): MemberView[] {
  const nextMembers = [...members]
  const fallbackSummaries: Record<string, TeamUserSummary> = { ...summaries }

  const upsertMember = (userId: string | undefined, role: TeamRole): void => {
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

  upsertMember(team?.creator_user_id, "creator")
  if (account && team) {
    upsertMember(account.id, accountRole ?? team.role ?? "member")
  }

  return buildMemberViews(nextMembers, fallbackSummaries)
}
