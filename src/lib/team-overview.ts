import type { Team, TeamOverview } from "../../electron/teams/common.ts"

export function mergeTeamUpdate(current: Team, updated: Team): Team {
  return {
    ...current,
    ...updated,
    role: updated.role ?? current.role,
    system_created: updated.system_created ?? current.system_created,
    writable: updated.writable ?? current.writable,
  }
}

export function sortSystemCreatedTeamFirst(teams: readonly Team[]): Team[] {
  return [...teams].sort((left, right) => Number(Boolean(right.system_created)) - Number(Boolean(left.system_created)))
}

export function mergeWorkspaceTeams(overview: TeamOverview | null): Team[] {
  if (!overview) {
    return []
  }

  const merged = new Map<string, Team>()
  for (const team of [...overview.created, ...overview.joined]) {
    const existing = merged.get(team.id)
    merged.set(team.id, existing ? mergeTeamUpdate(existing, team) : team)
  }
  return sortSystemCreatedTeamFirst([...merged.values()])
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
    if (team.role === "creator" || (team.role === undefined && team.creator_user_id === overview.accountId)) {
      created = [...created, team]
    } else if (team.role === "admin" || team.role === "member") {
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
  return teams.find((team) => team.system_created)?.id ?? teams[0]?.id ?? null
}
