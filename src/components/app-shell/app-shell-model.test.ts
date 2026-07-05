import { describe, expect, test } from "vitest"
import { isWorkspaceSwitchPending } from "./app-shell-model.ts"

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

  test("waits for organization skills when the target needs them", () => {
    expect(isWorkspaceSwitchPending({ ...readyInput, organizationSkillsSettled: false })).toBe(true)
  })

  test("settles when all target-scoped requests are done", () => {
    expect(isWorkspaceSwitchPending(readyInput)).toBe(false)
  })
})
