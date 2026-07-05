import { describe, expect, test } from "vitest"
import { isWorkspaceSwitchPending, shouldClearWorkspaceSwitchTarget } from "./app-shell-model.ts"

const readyInput = {
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
