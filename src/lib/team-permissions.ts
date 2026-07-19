import type { Team, TeamOverview, TeamRole } from "../../electron/teams/common.ts"

export function teamRole(overview: TeamOverview | null, team: Team | null): TeamRole | null {
  if (!overview || !team) {
    return null
  }
  if (team.role === "creator" || team.role === "member") {
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
  return teamRole(overview, team) === "creator"
}
