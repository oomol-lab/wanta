import type { ConnectionWorkspace } from "../../electron/connections/common.ts"
import type { Team, TeamOverview, TeamRole } from "../../electron/teams/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { branding } from "../../electron/branding.ts"
import { dropCachedAvatarImage } from "../lib/avatar-image-cache.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"
import { applyTeamPatchesToOverview, resolveTeamSelection, upsertOverviewTeam } from "../lib/team-overview.ts"
import { teamCanManage, teamRole } from "../lib/team-permissions.ts"
import { getTeamOverview } from "../lib/teams-client.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

export { teamAvatarStyle, teamInitials, teamAvatarPalette } from "../lib/team-avatar.ts"

export interface WorkspaceSelection {
  canManage: boolean
  team: Team | null
  avatarPreviewUrl?: string
  teamId: string
  role: TeamRole | null
}

export interface UseTeamWorkspace {
  activeWorkspace: WorkspaceSelection
  connectionWorkspace: ConnectionWorkspace | null
  error: UserFacingError | null
  getTeamCanManage: (team: Team) => boolean
  getTeamRole: (team: Team) => TeamRole
  hasLoaded: boolean
  loading: boolean
  teams: Team[]
  teamAvatarPreviewUrls: Record<string, string>
  clearTeamAvatarPreview: (teamId: string) => void
  refresh: (options?: TeamWorkspaceRefreshOptions) => Promise<void>
  selectTeam: (teamId: string) => void
  syncOverview: (overview: TeamOverview) => void
  upsertTeam: (team: Team, options?: TeamWorkspaceUpsertOptions) => void
}

export interface TeamWorkspaceRefreshOptions {
  forceRefresh?: boolean
}

export interface TeamWorkspaceUpsertOptions {
  avatarFile?: File | null
}

interface WorkspaceOverviewCacheEntry {
  accountId: string
  fetchedAt: number
  overview: TeamOverview
}

interface WorkspaceOverviewInFlightEntry {
  accountId: string
  promise: Promise<TeamOverview>
}

interface PendingWorkspaceTeamPatch {
  team: Team
  patchedAt: number
}

const selectedWorkspaceStorageKeyPrefix = `${branding.storageKeyPrefix}:active-workspace:`
const workspaceOverviewCacheMs = 30_000
const workspaceOverviewPatchTtlMs = 120_000
let workspaceOverviewCache: WorkspaceOverviewCacheEntry | null = null
let workspaceOverviewInFlight: WorkspaceOverviewInFlightEntry | null = null
const pendingWorkspaceTeamPatches = new Map<string, PendingWorkspaceTeamPatch>()

function workspaceTeamPatchKey(accountId: string, teamId: string): string {
  return `${accountId}\u0000${teamId}`
}

function selectedWorkspaceStorageKey(accountId: string): string {
  return `${selectedWorkspaceStorageKeyPrefix}${accountId}`
}

export function storedTeamIdFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const parsed = value as { organizationId?: unknown; teamId?: unknown }
  const storedTeamId = typeof parsed.teamId === "string" ? parsed.teamId : parsed.organizationId
  return typeof storedTeamId === "string" && storedTeamId.trim() ? storedTeamId.trim() : null
}

function readStoredTeamId(accountId: string | undefined): string | null {
  if (!accountId) {
    return null
  }
  try {
    const key = selectedWorkspaceStorageKey(accountId)
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    const storedTeamId = storedTeamIdFromValue(parsed)
    if (!storedTeamId) {
      return null
    }
    if (!("teamId" in parsed)) {
      window.localStorage.setItem(key, JSON.stringify({ teamId: storedTeamId }))
    }
    return storedTeamId
  } catch {
    return null
  }
}

function writeStoredWorkspace(accountId: string | undefined, teamId: string | null): void {
  if (!accountId) {
    return
  }
  try {
    const key = selectedWorkspaceStorageKey(accountId)
    if (teamId) {
      window.localStorage.setItem(key, JSON.stringify({ teamId }))
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // 本地记忆只是体验优化，失败不影响本次切换。
  }
}

function uniqueTeams(overview: TeamOverview | null): Team[] {
  if (!overview) {
    return []
  }
  const seen = new Set<string>()
  return [...overview.created, ...overview.joined].filter((team) => {
    if (seen.has(team.id)) {
      return false
    }
    seen.add(team.id)
    return true
  })
}

function rememberWorkspaceTeamPatch(accountId: string, team: Team): void {
  pendingWorkspaceTeamPatches.set(workspaceTeamPatchKey(accountId, team.id), {
    team,
    patchedAt: Date.now(),
  })
}

function activeWorkspaceTeamPatches(accountId: string, now = Date.now()): Team[] {
  const patches: Team[] = []
  const keyPrefix = `${accountId}\u0000`
  for (const [key, patch] of pendingWorkspaceTeamPatches) {
    if (now - patch.patchedAt > workspaceOverviewPatchTtlMs) {
      pendingWorkspaceTeamPatches.delete(key)
      continue
    }
    if (!key.startsWith(keyPrefix)) {
      continue
    }
    patches.push(patch.team)
  }
  return patches
}

function applyPendingWorkspaceTeamPatches(accountId: string, overview: TeamOverview): TeamOverview {
  const patches = activeWorkspaceTeamPatches(accountId)
  return patches.length > 0 ? applyTeamPatchesToOverview(overview, patches) : overview
}

function workspaceError(cause: unknown, hasLoaded: boolean): UserFacingError {
  const error = resolveUserFacingError(cause, { area: "generic" })
  return {
    ...error,
    descriptionKey: hasLoaded ? "teams.refreshFailedDescription" : "teams.loadFailedDescription",
    titleKey: hasLoaded ? "teams.refreshFailedTitle" : "teams.loadFailed",
  }
}

function readCachedWorkspaceOverview(accountId: string, options: TeamWorkspaceRefreshOptions): Promise<TeamOverview> {
  const now = Date.now()
  if (
    !options.forceRefresh &&
    workspaceOverviewCache?.accountId === accountId &&
    now - workspaceOverviewCache.fetchedAt < workspaceOverviewCacheMs
  ) {
    return Promise.resolve(workspaceOverviewCache.overview)
  }

  if (!options.forceRefresh && workspaceOverviewInFlight?.accountId === accountId) {
    return workspaceOverviewInFlight.promise
  }

  const promise = getTeamOverview(accountId).then((overview) => {
    if (workspaceOverviewInFlight?.promise === promise) {
      workspaceOverviewCache = { accountId, fetchedAt: Date.now(), overview }
    }
    return overview
  })
  workspaceOverviewInFlight = { accountId, promise }
  void promise
    .finally(() => {
      if (workspaceOverviewInFlight?.promise === promise) {
        workspaceOverviewInFlight = null
      }
    })
    .catch((error: unknown) => {
      reportRendererHandledError("team-workspace", "team overview request failed", error)
    })
  return promise
}

export function useTeamWorkspace(accountId: string | undefined): UseTeamWorkspace {
  const [overview, setOverview] = React.useState<TeamOverview | null>(null)
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(() => readStoredTeamId(accountId))
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [teamAvatarPreviewUrls, setTeamAvatarPreviewUrls] = React.useState<Record<string, string>>({})
  const requestIdRef = React.useRef(0)
  const loadedAccountIdRef = React.useRef<string | undefined>(undefined)
  const skipWorkspacePersistenceRef = React.useRef(false)
  const overviewRef = React.useRef<TeamOverview | null>(null)
  const teamAvatarPreviewUrlsRef = React.useRef(new Map<string, string>())

  React.useEffect(() => {
    if (loadedAccountIdRef.current === accountId) {
      return
    }
    loadedAccountIdRef.current = accountId
    skipWorkspacePersistenceRef.current = true
    requestIdRef.current += 1
    overviewRef.current = null
    setOverview(null)
    setError(null)
    setSelectedTeamId(readStoredTeamId(accountId))
  }, [accountId])

  React.useEffect(() => {
    if (skipWorkspacePersistenceRef.current) {
      // 切换账号的首轮 effect 仍持有旧选择，等待新账号的本地选择进入 state 后再持久化。
      skipWorkspacePersistenceRef.current = false
      return
    }
    writeStoredWorkspace(accountId, selectedTeamId)
  }, [accountId, selectedTeamId])

  const refresh = React.useCallback(
    async (options: TeamWorkspaceRefreshOptions = {}): Promise<void> => {
      if (!accountId) {
        overviewRef.current = null
        setOverview(null)
        setError(null)
        setLoading(false)
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const hadOverview = overviewRef.current !== null
      setLoading(true)
      try {
        const next = applyPendingWorkspaceTeamPatches(accountId, await readCachedWorkspaceOverview(accountId, options))
        if (requestIdRef.current !== requestId) {
          return
        }
        overviewRef.current = next
        setOverview(next)
        setError(null)
        const teams = uniqueTeams(next)
        setSelectedTeamId((current) => resolveTeamSelection(current, teams))
      } catch (err) {
        if (requestIdRef.current === requestId) {
          setError(workspaceError(err, hadOverview))
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [accountId],
  )

  const syncOverview = React.useCallback(
    (nextOverview: TeamOverview): void => {
      if (!accountId || nextOverview.accountId !== accountId) {
        return
      }
      const next = applyPendingWorkspaceTeamPatches(accountId, nextOverview)
      requestIdRef.current += 1
      overviewRef.current = next
      if (workspaceOverviewInFlight?.accountId === accountId) {
        workspaceOverviewInFlight = null
      }
      workspaceOverviewCache = { accountId, fetchedAt: Date.now(), overview: next }
      setOverview(next)
      setError(null)
      setLoading(false)
      const teams = uniqueTeams(next)
      setSelectedTeamId((current) => resolveTeamSelection(current, teams))
    },
    [accountId],
  )

  const clearTeamAvatarPreview = React.useCallback((teamId: string): void => {
    const currentPreviewUrl = teamAvatarPreviewUrlsRef.current.get(teamId)
    if (!currentPreviewUrl) {
      return
    }
    URL.revokeObjectURL(currentPreviewUrl)
    teamAvatarPreviewUrlsRef.current.delete(teamId)
    setTeamAvatarPreviewUrls(Object.fromEntries(teamAvatarPreviewUrlsRef.current))
  }, [])

  const setTeamAvatarPreview = React.useCallback((teamId: string, file: File | null): void => {
    const currentPreviewUrl = teamAvatarPreviewUrlsRef.current.get(teamId)
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl)
      teamAvatarPreviewUrlsRef.current.delete(teamId)
    }
    if (file) {
      teamAvatarPreviewUrlsRef.current.set(teamId, URL.createObjectURL(file))
    }
    setTeamAvatarPreviewUrls(Object.fromEntries(teamAvatarPreviewUrlsRef.current))
  }, [])

  const upsertTeam = React.useCallback(
    (team: Team, options: TeamWorkspaceUpsertOptions = {}): void => {
      if (!accountId) {
        return
      }
      rememberWorkspaceTeamPatch(accountId, team)
      if ("avatarFile" in options) {
        dropCachedAvatarImage(team.avatar)
        setTeamAvatarPreview(team.id, options.avatarFile ?? null)
      }
      setOverview((current) => {
        const next = upsertOverviewTeam(current, team)
        if (!next) {
          return current
        }
        overviewRef.current = next
        if (workspaceOverviewCache?.accountId === accountId) {
          workspaceOverviewCache = { ...workspaceOverviewCache, fetchedAt: Date.now(), overview: next }
        }
        return next
      })
    },
    [accountId, setTeamAvatarPreview],
  )

  React.useEffect(() => {
    return () => {
      for (const previewUrl of teamAvatarPreviewUrlsRef.current.values()) {
        URL.revokeObjectURL(previewUrl)
      }
      teamAvatarPreviewUrlsRef.current.clear()
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const teams = React.useMemo(() => uniqueTeams(overview), [overview])
  const selectedTeam = selectedTeamId ? (teams.find((team) => team.id === selectedTeamId) ?? null) : null
  const activeWorkspace = React.useMemo<WorkspaceSelection>(() => {
    if (!selectedTeamId || !selectedTeam) {
      return {
        canManage: false,
        team: null,
        teamId: "",
        role: null,
      }
    }
    return {
      avatarPreviewUrl: teamAvatarPreviewUrls[selectedTeamId],
      teamId: selectedTeamId,
      team: selectedTeam,
      role: teamRole(overview, selectedTeam),
      canManage: teamCanManage(overview, selectedTeam),
    }
  }, [teamAvatarPreviewUrls, overview, selectedTeam, selectedTeamId])
  const connectionWorkspace = React.useMemo<ConnectionWorkspace | null>(() => {
    return selectedTeam?.name ? { teamName: selectedTeam.name } : null
  }, [selectedTeam?.name, selectedTeamId])

  const selectTeam = React.useCallback((teamId: string) => {
    setSelectedTeamId(teamId)
  }, [])

  const getTeamRole = React.useCallback((team: Team): TeamRole => teamRole(overview, team) ?? "member", [overview])
  const getTeamCanManage = React.useCallback((team: Team): boolean => teamCanManage(overview, team), [overview])

  return React.useMemo(
    () => ({
      activeWorkspace,
      connectionWorkspace,
      error,
      getTeamCanManage,
      getTeamRole,
      hasLoaded: overview !== null,
      loading,
      teams,
      teamAvatarPreviewUrls,
      clearTeamAvatarPreview,
      refresh,
      selectTeam,
      syncOverview,
      upsertTeam,
    }),
    [
      activeWorkspace,
      clearTeamAvatarPreview,
      connectionWorkspace,
      error,
      getTeamCanManage,
      getTeamRole,
      loading,
      teams,
      teamAvatarPreviewUrls,
      overview,
      refresh,
      selectTeam,
      syncOverview,
      upsertTeam,
    ],
  )
}
