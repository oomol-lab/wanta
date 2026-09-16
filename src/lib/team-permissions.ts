import type { Team, TeamMember, TeamOverview, TeamRole, TeamMemberRole } from "../../electron/teams/common.ts"

export function teamRole(overview: TeamOverview | null, team: Team | null): TeamRole | null {
  if (!overview || !team) {
    return null
  }
  if (team.role === "creator" || team.role === "admin" || team.role === "member") {
    return team.role
  }
  return team.creator_user_id === overview.accountId || overview.created.some((created) => created.id === team.id)
    ? "creator"
    : "member"
}

export function teamCanManage(overview: TeamOverview | null, team: Team | null): boolean {
  if (!overview || !team) {
    return false
  }
  if (typeof team.writable === "boolean") {
    return team.writable
  }
  return isTeamManagerRole(teamRole(overview, team))
}

export function isTeamManagerRole(role: TeamRole | null): role is "creator" | "admin" {
  return role === "creator" || role === "admin"
}

export function teamRoleLabelKey(
  role: TeamMemberRole,
): "teams.roleAdmin" | "teams.roleCreator" | "teams.roleMember" | "teams.roleGuest" {
  if (role === "creator") {
    return "teams.roleCreator"
  }
  if (role === "admin") {
    return "teams.roleAdmin"
  }
  if (role === "guest") return "teams.roleGuest"
  return "teams.roleMember"
}

export function teamRoleHasDefaultConnectionAccess(role: TeamMemberRole): boolean {
  return role === "creator" || role === "admin"
}

export function canChangeTeamMemberRole({
  actorCanManage,
  actorRole,
  actorUserId,
  member,
}: {
  actorCanManage: boolean
  actorRole: TeamRole | null
  actorUserId: string | undefined
  member: TeamMember
}): boolean {
  if (
    !actorCanManage ||
    !isTeamManagerRole(actorRole) ||
    member.role === "creator" ||
    member.user_type === "service-account"
  ) {
    return false
  }
  if (actorRole !== "admin") {
    return true
  }
  return Boolean(actorUserId) && member.user_id !== actorUserId
}
