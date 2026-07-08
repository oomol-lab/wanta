import { describe, expect, test } from "vitest"
import {
  existingSessionComposerDraftKey,
  getUnlinkedProviderSkillRecommendations,
  NO_DRAFT_PROJECT_ID,
  isWorkspaceSwitchPending,
  newSessionComposerDraftKey,
  newSessionComposerDraftKeyForScopeKey,
  resolveNewSessionTarget,
  sessionRecordScopeKey,
  shouldClearWorkspaceSwitchTarget,
  shouldShowRecommendedSkillEntry,
} from "./app-shell-model.ts"

const readyInput = {
  agentScopeSyncFailed: false,
  agentScopeWorkspaceKey: "personal",
  connectionSettledWorkspaceKey: "personal",
  connectionWorkspaceKey: "personal",
  connectionsRefreshing: false,
  currentScopeKey: "personal",
  loadedSessionScopeKey: "personal",
  organizationSkillsSettled: true,
  targetScopeKey: "personal",
}

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
        agentScopeSyncFailed: true,
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
        activeWorkspaceKey: "personal",
        organizationIds: [],
      }),
    ).toBe(true)
  })

  test("keeps a reachable target while the active workspace catches up", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "personal",
      }),
    ).toBe(false)
  })

  test("keeps an organization target reachable while organizations are still loading", () => {
    expect(
      shouldClearWorkspaceSwitchTarget({
        ...cleanupInput,
        activeWorkspaceKey: "personal",
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

  test("keeps a new chat inside the active project session", () => {
    expect(resolveNewSessionTarget({ activeSession: { projectId: "project-a" }, draftProjectId: null })).toEqual({
      projectId: "project-a",
      sidebarSegment: "projects",
    })
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
})

describe("composer draft scope keys", () => {
  test("separates existing session drafts by workspace scope", () => {
    expect(existingSessionComposerDraftKey("organization:org-a", "session-1")).not.toBe(
      existingSessionComposerDraftKey("organization:org-b", "session-1"),
    )
    expect(existingSessionComposerDraftKey("organization:org-a", "session-1")).not.toBe(
      existingSessionComposerDraftKey("personal", "session-1"),
    )
  })

  test("separates new session drafts by workspace scope", () => {
    expect(
      newSessionComposerDraftKey({ type: "organization", organizationId: "org-a", organizationName: "A" }, undefined),
    ).not.toBe(newSessionComposerDraftKey({ type: "personal" }, undefined))
  })

  test("normalizes persisted sessions without scope as personal sessions", () => {
    expect(sessionRecordScopeKey(undefined)).toBe("personal")
    expect(sessionRecordScopeKey({ type: "organization", organizationId: "org-a", organizationName: "A" })).toBe(
      "organization:org-a",
    )
  })
})
