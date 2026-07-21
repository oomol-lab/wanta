import assert from "node:assert/strict"
import { test } from "vitest"
import { normalizeSessionScopeValue, sessionScopeKey, sessionScopesEqual } from "./common.ts"

test("normalizes explicit local and team workspace scopes", () => {
  assert.deepEqual(normalizeSessionScopeValue({ kind: "local", workspaceId: " local ", workspaceName: " Local " }), {
    kind: "local",
    workspaceId: "local",
    workspaceName: "Local",
  })
  assert.deepEqual(normalizeSessionScopeValue({ kind: "team", teamId: " team ", teamName: " Team " }), {
    kind: "team",
    teamId: "team",
    teamName: "Team",
  })
})

test("migrates legacy team scopes without accepting malformed explicit scopes", () => {
  assert.deepEqual(normalizeSessionScopeValue({ teamId: "team", teamName: "Team" }), {
    kind: "team",
    teamId: "team",
    teamName: "Team",
  })
  assert.deepEqual(normalizeSessionScopeValue({ organizationId: "team", organizationName: "Team" }), {
    kind: "team",
    teamId: "team",
    teamName: "Team",
  })
  assert.equal(normalizeSessionScopeValue({ kind: "local", workspaceId: "local", workspaceName: "" }), undefined)
  assert.equal(normalizeSessionScopeValue({ kind: "unknown", teamId: "team", teamName: "Team" }), undefined)
})

test("keys local and team workspaces in separate namespaces", () => {
  const local = { kind: "local" as const, workspaceId: "shared", workspaceName: "Local" }
  const team = { kind: "team" as const, teamId: "shared", teamName: "Team" }

  assert.equal(sessionScopeKey(local), "local:shared")
  assert.equal(sessionScopeKey(team), "team:shared")
  assert.equal(sessionScopesEqual(local, team), false)
  assert.equal(sessionScopesEqual(local, { ...local, workspaceName: "Renamed" }), true)
})
