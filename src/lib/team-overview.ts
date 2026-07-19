import type { Team, TeamOverview } from "../../electron/teams/common.ts"

export function mergeTeamUpdate(current: Team, updated: Team): Team {
  return {
    ...current,
    ...updated,
    role: updated.role ?? current.role,
    writable: updated.writable ?? current.writable,
  }
}

export function upsertOverviewTeam(overview: TeamOverview | null, team: Team): TeamOverview | null {
  if (!overview) {
    return null
  }

  let found = false
  const patchList = (items: Team[]) =>
    items.map((item) => {
      if (item.id !== team.id) {
        return item
      }
      found = true
      return mergeTeamUpdate(item, team)
    })

  let created = patchList(overview.created)
  let joined = patchList(overview.joined)

  if (!found) {
    if (team.creator_user_id === overview.accountId || team.role === "creator") {
      created = [...created, team]
    } else if (team.role === "member") {
      joined = [...joined, team]
    } else {
      return overview
    }
  }

  return { ...overview, created, joined, updatedAt: new Date().toISOString() }
}

export function applyTeamPatchesToOverview(overview: TeamOverview, teams: readonly Team[]): TeamOverview {
  return teams.reduce((current, team) => upsertOverviewTeam(current, team) ?? current, overview)
}

export function resolveTeamSelection(selectedTeamId: string | null, teams: readonly Team[]): string | null {
  if (selectedTeamId && teams.some((team) => team.id === selectedTeamId)) {
    return selectedTeamId
  }
  return teams[0]?.id ?? null
}
