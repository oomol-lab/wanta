import { describe, expect, test } from "vitest"
import {
  existingSessionComposerDraftKey,
  chatSendAccepted,
  getUnlinkedProviderSkillRecommendations,
  NO_DRAFT_PROJECT_ID,
  isWorkspaceSwitchPending,
  newSessionComposerDraftKey,
  newSessionComposerDraftKeyForScopeKey,
  resolveNewSessionTarget,
  resolveWorkspaceActivationState,
  sessionRecordScopeKey,
  sessionTitleGenerationKey,
  shouldClearWorkspaceSwitchTarget,
  shouldShowRecommendedSkillEntry,
  workspaceActivationBlocksInput,
  workspaceActivationHasFailed,
  workspaceActivationIsPending,
} from "./app-shell-model.ts"

const readyInput = {
  agentScopeSyncError: null,
  agentScopeWorkspaceKey: "organization:acme",
  connectionSettledWorkspaceKey: "organization:acme",
  connectionWorkspaceKey: "organization:acme",
  connectionsRefreshing: false,
  currentScopeKey: "organization:acme",
  loadedSessionScopeKey: "organization:acme",
  organizationSkillsError: null,
  organizationSkillsSettled: true,
  targetScopeKey: "organization:acme",
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
    expect(isWorkspaceSwitchPending({ ...readyInput, loadedSessionScopeKey: "organization:old" })).toBe(true)
  })

  test("waits for the current connection workspace to settle", () => {
    expect(
      isWorkspaceSwitchPending({
        ...readyInput,
        connectionSettledWorkspaceKey: "organization:Old",
        connectionWorkspaceKey: "organization:New",
      }),
    ).toBe(true)
  })

  test("waits until the agent organization scope reaches the target workspace", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, agentScopeWorkspaceKey: "organization:old" })).toBe(true)
  })

  test("stops waiting when agent organization scope sync fails", () => {
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

  test("waits for organization skills when the target needs them", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, organizationSkillsSettled: false })).toBe(true)
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
    const state = resolveWorkspaceActivationState({ ...readyInput, loadedSessionScopeKey: "organization:old" })

    expect(state).toEqual({ phase: "sessions", status: "activating", targetScopeKey: "organization:acme" })
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
      targetScopeKey: "organization:acme",
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
      targetScopeKey: "organization:acme",
    })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(true)
  })

  test("fails when organization skills cannot load for the active workspace", () => {
    const state = resolveWorkspaceActivationState({
      ...readyInput,
      organizationSkillsError: activationError,
      organizationSkillsSettled: false,
    })

    expect(state).toEqual({
      error: activationError,
      reason: "organization_skills",
      status: "failed",
      targetScopeKey: "organization:acme",
    })
    expect(workspaceActivationIsPending(state)).toBe(false)
    expect(workspaceActivationBlocksInput(state)).toBe(true)
    expect(workspaceActivationHasFailed(state)).toBe(true)
  })

  test("is idle once every target-scoped dependency settles", () => {
    const state = resolveWorkspaceActivationState(readyInput)

    expect(state).toEqual({ status: "idle", targetScopeKey: "organization:acme" })
  })
})

describe("recommended Skill empty state entry", () => {
  test("shows when a provider recommendation is installable without organization configured Skills", () => {
    expect(
      shouldShowRecommendedSkillEntry({
        organizationId: "org-1",
        organizationSkillCount: 0,
        providerRecommendationCount: 1,
      }),
    ).toBe(true)
  })

  test("stays hidden outside an organization workspace", () => {
    expect(
      shouldShowRecommendedSkillEntry({
        organizationId: null,
        organizationSkillCount: 0,
        providerRecommendationCount: 1,
      }),
    ).toBe(false)
  })

  test("deduplicates provider recommendations already configured by the organization", () => {
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
    activeWorkspaceKey: "organization:new",
    hasLoadedOrganizations: true,
    loadingOrganizations: false,
    organizationIds: ["new"],
    targetScopeKey: "organization:new",
    workspaceSwitching: true,
  }

  test("keeps a reachable target while requests are still pending", () => {
    expect(shouldClearWorkspaceSwitchTarget(cleanupInput)).toBe(false)
  })

  test("clears when the target settles", () => {
    expect(shouldClearWorkspaceSwitchTarget({ ...cleanupInput, workspaceSwitching: false })).toBe(true)
  })

  test("clears when an organization target is no longer reachable", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "organization:acme",
        organizationIds: [],
      }),
    ).toBe(true)
  })

  test("keeps a reachable target while the active workspace catches up", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "organization:acme",
      }),
    ).toBe(false)
  })

  test("keeps an organization target reachable while organizations are still loading", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "organization:acme",
        hasLoadedOrganizations: false,
        loadingOrganizations: true,
        organizationIds: [],
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
  test("keeps loading organization draft keys separated by selected workspace", () => {
    expect(newSessionComposerDraftKey(null, undefined)).toBe("__new_session__:workspace-loading:none")
    expect(newSessionComposerDraftKeyForScopeKey("organization:org-a", undefined)).toBe(
      "__new_session__:organization:org-a:none",
    )
    expect(newSessionComposerDraftKeyForScopeKey("organization:org-b", "project-1")).toBe(
      "__new_session__:organization:org-b:project-1",
    )
  })

  test("separates drafts for projects in the same workspace", () => {
    const scope = { organizationId: "org-a", organizationName: "A" }

    expect(newSessionComposerDraftKey(scope, "project-a")).not.toBe(newSessionComposerDraftKey(scope, "project-b"))
  })
})

describe("composer draft scope keys", () => {
  test("separates existing session drafts by workspace scope", () => {
    expect(existingSessionComposerDraftKey("organization:org-a", "session-1")).not.toBe(
      existingSessionComposerDraftKey("organization:org-b", "session-1"),
    )
    expect(existingSessionComposerDraftKey("organization:org-a", "session-1")).not.toBe(
      existingSessionComposerDraftKey("organization:acme", "session-1"),
    )
  })

  test("separates new session drafts by workspace scope", () => {
    expect(newSessionComposerDraftKey({ organizationId: "org-a", organizationName: "A" }, undefined)).not.toBe(
      newSessionComposerDraftKey({ organizationId: "org-id", organizationName: "org-name" }, undefined),
    )
  })

  test("normalizes persisted sessions without scope as unavailable workspace sessions", () => {
    expect(sessionRecordScopeKey(undefined)).toBe("workspace-loading")
    expect(sessionRecordScopeKey({ organizationId: "org-a", organizationName: "A" })).toBe("organization:org-a")
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
