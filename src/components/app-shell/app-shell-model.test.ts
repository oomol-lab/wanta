import { afterEach, describe, expect, test, vi } from "vitest"
import {
  existingSessionComposerDraftKey,
  chatSendAccepted,
  getUnlinkedProviderSkillRecommendations,
  initialRoute,
  NO_DRAFT_PROJECT_ID,
  isWorkspaceSwitchPending,
  newSessionComposerDraftKey,
  newSessionComposerDraftKeyForScopeKey,
  resolveNewSessionTarget,
  resolveNotificationTeam,
  routeAvailableForRuntime,
  resolveTeamProviderOptionsAvailability,
  resolveWorkspaceActivationState,
  sessionRecordScopeKey,
  sessionScopeFromWorkspace,
  sessionTitleGenerationKey,
  shouldClearWorkspaceSwitchTarget,
  shouldShowRecommendedSkillEntry,
  workspaceActivationBlocksInput,
  workspaceActivationHasFailed,
  workspaceActivationIsPending,
  workspaceSelectionSwitchKey,
  workspaceSwitchTeamId,
} from "./app-shell-model.ts"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("team route and scope migration", () => {
  test("maps the legacy organizations route to teams", () => {
    vi.stubEnv("VITE_WANTA_ROUTE", "organizations")
    expect(initialRoute()).toBe("teams")
  })

  test("accepts team and legacy organization scope keys", () => {
    expect(workspaceSwitchTeamId("team:team-1")).toBe("team-1")
    expect(workspaceSwitchTeamId("organization:team-1")).toBe("team-1")
    expect(workspaceSwitchTeamId("personal:user-1")).toBeNull()
  })
})

describe("local workspace", () => {
  const localWorkspace = { canManage: false, kind: "local" as const, role: null, team: null, teamId: "" }

  test("maps the local workspace to the stable local session scope", () => {
    expect(sessionScopeFromWorkspace(localWorkspace)).toEqual({
      kind: "local",
      workspaceId: "local",
      workspaceName: "Local",
    })
    expect(workspaceSelectionSwitchKey(localWorkspace)).toBe("local:local")
  })

  test("settles activation after local sessions load without cloud dependencies", () => {
    expect(
      resolveWorkspaceActivationState({
        ...readyInput,
        agentScopeSyncError: activationError,
        cloudWorkspaceRequired: false,
        connectionWorkspaceKey: null,
        currentScopeKey: "local:local",
        loadedSessionScopeKey: "local:local",
        targetScopeKey: "local:local",
        workspaceMetadataError: activationError,
      }),
    ).toEqual({ status: "idle", targetScopeKey: "local:local" })
  })

  test("keeps community routes available while blocking account-only pages", () => {
    expect(routeAvailableForRuntime("chat", false)).toBe(true)
    expect(routeAvailableForRuntime("knowledge", false)).toBe(true)
    expect(routeAvailableForRuntime("settings", false)).toBe(true)
    expect(routeAvailableForRuntime("connections", false)).toBe(true)
    expect(routeAvailableForRuntime("skills", false)).toBe(true)
    expect(routeAvailableForRuntime("teams", false)).toBe(false)
    expect(routeAvailableForRuntime("billing", false)).toBe(false)
    expect(routeAvailableForRuntime("billing", true)).toBe(true)
  })
})

describe("notification team resolution", () => {
  const input = {
    activeTeamId: "team-current",
    hasLoaded: true,
    loading: false,
    teamIds: ["team-current", "team-target"],
    refreshAttempted: false,
    targetTeamId: "team-target",
  }

  test("selects a known notification team", () => {
    expect(resolveNotificationTeam(input)).toBe("select")
  })

  test("refreshes once before rejecting an unknown notification team", () => {
    const unknown = { ...input, teamIds: [] }
    expect(resolveNotificationTeam(unknown)).toBe("refresh")
    expect(resolveNotificationTeam({ ...unknown, refreshAttempted: true })).toBe("unavailable")
  })

  test("waits while the team list is unresolved", () => {
    expect(resolveNotificationTeam({ ...input, hasLoaded: false, teamIds: [] })).toBe("wait")
  })
})

describe("team provider option availability", () => {
  test("waits for the shared connection summary instead of starting a duplicate request", () => {
    expect(
      resolveTeamProviderOptionsAvailability({
        appsStatus: undefined,
        summaryMatchesWorkspace: false,
        workspaceActivationFailed: false,
      }),
    ).toBe("pending")
  })

  test("uses shared provider options after the workspace summary is ready", () => {
    expect(
      resolveTeamProviderOptionsAvailability({
        appsStatus: "ready",
        summaryMatchesWorkspace: true,
        workspaceActivationFailed: false,
      }),
    ).toBe("ready")
  })

  test("allows the details request fallback after shared loading fails", () => {
    expect(
      resolveTeamProviderOptionsAvailability({
        appsStatus: undefined,
        summaryMatchesWorkspace: false,
        workspaceActivationFailed: true,
      }),
    ).toBe("fallback")
  })
})

const readyInput = {
  agentScopeSyncError: null,
  agentScopeWorkspaceKey: "team:acme",
  connectionSettledWorkspaceKey: "team:acme",
  connectionWorkspaceKey: "team:acme",
  connectionsRefreshing: false,
  cloudWorkspaceRequired: true,
  currentScopeKey: "team:acme",
  loadedSessionScopeKey: "team:acme",
  teamSkillsSettled: true,
  targetScopeKey: "team:acme",
  workspaceMetadataError: null,
}

const activationError = {
  area: "connections",
  descriptionKey: "error.connections.description",
  kind: "operation_failed",
  severity: "destructive",
  titleKey: "error.connections.title",
} as const

describe("workspace switch pending state", () => {
  test("is inactive when no switch target is pending", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, targetScopeKey: null })).toBe(false)
  })

  test("waits until the active session scope reaches the target", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, currentScopeKey: "workspace-loading" })).toBe(true)
  })

  test("waits for sessions to load for the target scope", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, loadedSessionScopeKey: "team:old" })).toBe(true)
  })

  test("waits for the current connection workspace to settle", () => {
    expect(
      isWorkspaceSwitchPending({
        ...readyInput,
        connectionSettledWorkspaceKey: "team:Old",
        connectionWorkspaceKey: "team:New",
      }),
    ).toBe(true)
  })

  test("waits until the agent team scope reaches the target workspace", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, agentScopeWorkspaceKey: "team:old" })).toBe(true)
  })

  test("stops waiting when agent team scope sync fails", () => {
    expect(
      isWorkspaceSwitchPending({
        ...readyInput,
        agentScopeSyncError: activationError,
        agentScopeWorkspaceKey: null,
        connectionSettledWorkspaceKey: null,
      }),
    ).toBe(false)
  })

  test("waits while connections are actively refreshing", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, connectionsRefreshing: true })).toBe(true)
  })

  test("waits until the connection workspace key is available", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, connectionWorkspaceKey: null })).toBe(true)
  })

  test("waits for team skills when the target needs them", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, teamSkillsSettled: false })).toBe(true)
  })

  test("settles when all target-scoped requests are done", () => {
    expect(isWorkspaceSwitchPending(readyInput)).toBe(false)
  })
})

describe("chat send result", () => {
  test("only treats accepted send results as accepted", () => {
    expect(chatSendAccepted({ delivery: "sent", status: "accepted" })).toBe(true)
    expect(chatSendAccepted({ delivery: "queued", status: "accepted" })).toBe(true)
    expect(chatSendAccepted({ reason: "workspace_not_ready", status: "rejected" })).toBe(false)
    expect(chatSendAccepted({ error: new Error("failed"), status: "failed" })).toBe(false)
  })
})

describe("workspace activation state", () => {
  test("is idle without a switch target", () => {
    const state = resolveWorkspaceActivationState({ ...readyInput, targetScopeKey: null })

    expect(state).toEqual({ status: "idle", targetScopeKey: null })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(false)
    expect(workspaceActivationHasFailed(state)).toBe(false)
  })

  test("reports the first pending activation phase", () => {
    const state = resolveWorkspaceActivationState({ ...readyInput, loadedSessionScopeKey: "team:old" })

    expect(state).toEqual({ phase: "sessions", status: "activating", targetScopeKey: "team:acme" })
    expect(workspaceActivationIsPending(state)).toBe(true)
    expect(workspaceActivationBlocksInput(state)).toBe(true)
    expect(workspaceActivationHasFailed(state)).toBe(false)
  })

  test("blocks input but stops spinner semantics after agent scope sync failure", () => {
    const state = resolveWorkspaceActivationState({
      ...readyInput,
      agentScopeSyncError: activationError,
      agentScopeWorkspaceKey: null,
      connectionSettledWorkspaceKey: null,
    })

    expect(state).toEqual({
      error: activationError,
      reason: "agent_scope",
      status: "failed",
      targetScopeKey: "team:acme",
    })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(true)
    expect(workspaceActivationHasFailed(state)).toBe(true)
  })

  test("keeps agent scope sync failure blocking after the switch target is cleared", () => {
    const state = resolveWorkspaceActivationState({
      ...readyInput,
      agentScopeSyncError: activationError,
      targetScopeKey: null,
    })

    expect(state).toEqual({
      error: activationError,
      reason: "agent_scope",
      status: "failed",
      targetScopeKey: null,
    })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(true)
  })

  test("fails when the selected workspace metadata cannot resolve an identity", () => {
    const state = resolveWorkspaceActivationState({
      ...readyInput,
      connectionWorkspaceKey: null,
      workspaceMetadataError: activationError,
    })

    expect(state).toEqual({
      error: activationError,
      reason: "workspace_metadata",
      status: "failed",
      targetScopeKey: "team:acme",
    })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(true)
  })

  test("treats team skill loading failures as a soft dependency", () => {
    const state = resolveWorkspaceActivationState({
      ...readyInput,
      teamSkillsSettled: true,
    })

    expect(state).toEqual({ status: "idle", targetScopeKey: "team:acme" })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(false)
    expect(workspaceActivationHasFailed(state)).toBe(false)
  })

  test("is idle once every target-scoped dependency settles", () => {
    const state = resolveWorkspaceActivationState(readyInput)

    expect(state).toEqual({ status: "idle", targetScopeKey: "team:acme" })
  })
})

describe("recommended Skill empty state entry", () => {
  test("shows when a provider recommendation is installable without team configured Skills", () => {
    expect(
      shouldShowRecommendedSkillEntry({
        teamId: "team-1",
        teamSkillCount: 0,
        providerRecommendationCount: 1,
      }),
    ).toBe(true)
  })

  test("stays hidden outside a team workspace", () => {
    expect(
      shouldShowRecommendedSkillEntry({
        teamId: null,
        teamSkillCount: 0,
        providerRecommendationCount: 1,
      }),
    ).toBe(false)
  })

  test("deduplicates provider recommendations already configured by the team", () => {
    const recommendations = getUnlinkedProviderSkillRecommendations(
      [{ packageName: "oo-posthog", skillName: "posthog" }],
      [
        { packageName: "oo-posthog", service: "posthog", skillId: "posthog" },
        { packageName: "oo-posthog", service: "posthog-admin", skillId: "posthog-admin" },
        { packageName: "oo-gmail", service: "gmail", skillId: "gmail" },
      ],
    )

    expect(recommendations).toEqual([{ packageName: "oo-gmail", service: "gmail", skillId: "gmail" }])
  })
})

describe("workspace switch target cleanup", () => {
  const cleanupInput = {
    activeWorkspaceKey: "team:new",
    hasLoadedTeams: true,
    loadingTeams: false,
    teamIds: ["new"],
    targetScopeKey: "team:new",
    workspaceSwitching: true,
  }

  test("keeps a reachable target while requests are still pending", () => {
    expect(shouldClearWorkspaceSwitchTarget(cleanupInput)).toBe(false)
  })

  test("clears when the target settles", () => {
    expect(shouldClearWorkspaceSwitchTarget({ ...cleanupInput, workspaceSwitching: false })).toBe(true)
  })

  test("clears when a team target is no longer reachable", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "team:acme",
        teamIds: [],
      }),
    ).toBe(true)
  })

  test("keeps a reachable target while the active workspace catches up", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "team:acme",
      }),
    ).toBe(false)
  })

  test("keeps a team target reachable while teams are still loading", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "team:acme",
        hasLoadedTeams: false,
        loadingTeams: true,
        teamIds: [],
      }),
    ).toBe(false)
  })
})

describe("new session target resolution", () => {
  test("opens a root task draft without project context", () => {
    expect(resolveNewSessionTarget({ draftProjectId: null })).toEqual({ sidebarSegment: "tasks" })
  })

  test("keeps a new chat inside the active project session from the Projects tab", () => {
    expect(
      resolveNewSessionTarget({
        activeSession: { projectId: "project-a" },
        draftProjectId: null,
        sidebarSegment: "projects",
      }),
    ).toEqual({ projectId: "project-a", sidebarSegment: "projects" })
  })

  test("opens a root task from the Tasks tab even when the active session belongs to a project", () => {
    expect(
      resolveNewSessionTarget({
        activeSession: { projectId: "project-a" },
        draftProjectId: null,
        sidebarSegment: "tasks",
      }),
    ).toEqual({ sidebarSegment: "tasks" })
  })

  test("keeps a new chat inside the active project draft", () => {
    expect(resolveNewSessionTarget({ draftProjectId: "project-b" })).toEqual({
      projectId: "project-b",
      sidebarSegment: "projects",
    })
  })

  test("treats the explicit no-project draft marker as a root task", () => {
    expect(resolveNewSessionTarget({ draftProjectId: NO_DRAFT_PROJECT_ID })).toEqual({ sidebarSegment: "tasks" })
  })

  test("lets an explicit project row target override the active task context", () => {
    expect(
      resolveNewSessionTarget({
        activeSession: {},
        draftProjectId: NO_DRAFT_PROJECT_ID,
        explicitProjectId: "project-c",
        sidebarSegment: "tasks",
      }),
    ).toEqual({
      projectId: "project-c",
      sidebarSegment: "projects",
    })
  })

  test("can fall back to the last chat project from non-chat routes", () => {
    expect(
      resolveNewSessionTarget({ draftProjectId: null, lastProjectId: "project-d", preferLastProject: true }),
    ).toEqual({
      projectId: "project-d",
      sidebarSegment: "projects",
    })
  })

  test("ignores last project context unless requested", () => {
    expect(resolveNewSessionTarget({ draftProjectId: null, lastProjectId: "project-d" })).toEqual({
      sidebarSegment: "tasks",
    })
  })
})

describe("composer draft keys", () => {
  test("keeps loading team draft keys separated by selected workspace", () => {
    expect(newSessionComposerDraftKey(null, undefined)).toBe("__new_session__:workspace-loading:none")
    expect(newSessionComposerDraftKeyForScopeKey("team:team-a", undefined)).toBe("__new_session__:team:team-a:none")
    expect(newSessionComposerDraftKeyForScopeKey("team:team-b", "project-1")).toBe(
      "__new_session__:team:team-b:project-1",
    )
  })

  test("separates drafts for projects in the same workspace", () => {
    const scope = { kind: "team" as const, teamId: "team-a", teamName: "A" }

    expect(newSessionComposerDraftKey(scope, "project-a")).not.toBe(newSessionComposerDraftKey(scope, "project-b"))
  })
})

describe("composer draft scope keys", () => {
  test("separates existing session drafts by workspace scope", () => {
    expect(existingSessionComposerDraftKey("team:team-a", "session-1")).not.toBe(
      existingSessionComposerDraftKey("team:team-b", "session-1"),
    )
    expect(existingSessionComposerDraftKey("team:team-a", "session-1")).not.toBe(
      existingSessionComposerDraftKey("team:acme", "session-1"),
    )
  })

  test("separates new session drafts by workspace scope", () => {
    expect(newSessionComposerDraftKey({ kind: "team", teamId: "team-a", teamName: "A" }, undefined)).not.toBe(
      newSessionComposerDraftKey({ kind: "team", teamId: "team-id", teamName: "team-name" }, undefined),
    )
  })

  test("keeps local and team workspace draft keys distinct", () => {
    expect(
      newSessionComposerDraftKey({ kind: "local", workspaceId: "shared", workspaceName: "Local" }, undefined),
    ).toBe("__new_session__:local:shared:none")
    expect(newSessionComposerDraftKey({ kind: "team", teamId: "shared", teamName: "Team" }, undefined)).toBe(
      "__new_session__:team:shared:none",
    )
  })

  test("normalizes persisted sessions without scope as unavailable workspace sessions", () => {
    expect(sessionRecordScopeKey(undefined)).toBe("workspace-loading")
    expect(sessionRecordScopeKey({ kind: "team", teamId: "team-a", teamName: "A" })).toBe("team:team-a")
    expect(sessionRecordScopeKey({ kind: "local", workspaceId: "local", workspaceName: "Local" })).toBe("local:local")
  })
})

describe("session title generation keys", () => {
  test("separates requests that use different chat models", () => {
    const input = { text: "分析注册来源" }
    expect(sessionTitleGenerationKey({ ...input, model: { kind: "builtin", id: "deepseek-v4-flash" } }, true)).not.toBe(
      sessionTitleGenerationKey({ ...input, model: { kind: "custom", id: "custom-1" } }, true),
    )
  })
})
