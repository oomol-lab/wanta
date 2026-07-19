import type { ConnectionAppSummary } from "../../electron/connections/common.ts"

import { afterEach, describe, expect, it } from "vitest"
import {
  clearOAuthPendingOperations,
  connectionWorkspaceKey,
  createConnectionPollingKey,
  createOAuthPendingOperation,
  createOAuthPendingKey,
  isConnectionServicePollingTarget,
  isConnectionPollingTarget,
  readOAuthPendingOperation,
  readOAuthPendingOperationsForWorkspace,
  rememberOAuthPendingOperation,
  resolveOAuthConnectionReadyTarget,
} from "./connection-oauth-pending.ts"

function connectionApp(
  id: string,
  service: string,
  connectionName: string,
  status: ConnectionAppSummary["status"] = "active",
): ConnectionAppSummary {
  return {
    authType: "oauth2",
    connectionName,
    createdAt: 1,
    id,
    isDefault: false,
    service,
    status,
    updatedAt: 1,
  }
}

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>()

  public get length(): number {
    return this.items.size
  }

  public clear(): void {
    this.items.clear()
  }

  public getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  public key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null
  }

  public removeItem(key: string): void {
    this.items.delete(key)
  }

  public setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
}

describe("connection OAuth pending key", () => {
  const storage = new MemoryStorage()

  afterEach(() => {
    clearOAuthPendingOperations(storage)
  })

  it("deduplicates OAuth requests by workspace, service, and target app", () => {
    const workspace = { teamName: "team-name" } as const

    expect(createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" })).toBe(
      createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" }),
    )
    expect(createOAuthPendingKey(workspace, { authType: "oauth2", service: "gmail" })).not.toBe(
      createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" }),
    )
  })

  it("separates services and team workspaces", () => {
    const firstTeamGmail = createOAuthPendingKey({ teamName: "team-name" }, { authType: "oauth2", service: "gmail" })
    const firstTeamSlack = createOAuthPendingKey({ teamName: "team-name" }, { authType: "oauth2", service: "slack" })
    const secondTeamGmail = createOAuthPendingKey({ teamName: "acme" }, { authType: "oauth2", service: "gmail" })

    expect(firstTeamGmail).not.toBe(firstTeamSlack)
    expect(firstTeamGmail).not.toBe(secondTeamGmail)
  })

  it("shares workspace and polling key formatting helpers", () => {
    expect(connectionWorkspaceKey({ teamName: "team-name" })).toBe("team:team-name")
    expect(connectionWorkspaceKey({ teamName: "acme" })).toBe("team:acme")
    expect(createConnectionPollingKey("gmail")).toBe("gmail")
    expect(createConnectionPollingKey("gmail", "app-1")).toBe("gmail\0app-1")
    expect(isConnectionPollingTarget("gmail\0app-1", "gmail", "app-1")).toBe(true)
    expect(isConnectionPollingTarget("gmail\0app-1", "gmail", "app-2")).toBe(false)
    expect(isConnectionServicePollingTarget("gmail\0app-1", "gmail")).toBe(true)
    expect(isConnectionServicePollingTarget("slack\0app-1", "gmail")).toBe(false)
  })

  it("stores pending OAuth operations until they expire", () => {
    const workspace = { teamName: "team-name" } as const
    const operation = createOAuthPendingOperation(
      workspace,
      { appId: "app-1", authType: "oauth2", service: "gmail" },
      7,
      1_000,
      ["app-0"],
    )

    rememberOAuthPendingOperation(operation, storage)

    expect(readOAuthPendingOperation(operation.key, operation.expiresAt - 1, storage)).toMatchObject({
      actionId: 7,
      appId: "app-1",
      existingActiveAppIds: ["app-0"],
      pollingKey: "gmail\0app-1",
      service: "gmail",
      workspaceKey: "team:team-name",
    })
    expect(readOAuthPendingOperation(operation.key, operation.expiresAt, storage)).toBeNull()
  })

  it("keeps only one pending OAuth operation per workspace", () => {
    const teamName = { teamName: "team-name" } as const
    const team = { teamName: "acme" } as const
    const first = createOAuthPendingOperation(teamName, { authType: "oauth2", service: "gmail" }, 1, 1_000)
    const second = createOAuthPendingOperation(teamName, { authType: "oauth2", service: "slack" }, 2, 2_000)
    const otherWorkspace = createOAuthPendingOperation(team, { authType: "oauth2", service: "gmail" }, 3, 3_000)

    rememberOAuthPendingOperation(first, storage)
    rememberOAuthPendingOperation(second, storage)
    rememberOAuthPendingOperation(otherWorkspace, storage)

    expect(readOAuthPendingOperationsForWorkspace(teamName, 3_000, storage)).toEqual([second])
    expect(readOAuthPendingOperationsForWorkspace(team, 3_000, storage)).toEqual([otherWorkspace])
  })

  it("resolves the newly connected OAuth account after polling resumes", () => {
    const operation = createOAuthPendingOperation(
      { teamName: "team-name" },
      { authType: "oauth2", service: "gmail" },
      1,
      1_000,
      ["existing"],
    )

    expect(
      resolveOAuthConnectionReadyTarget(
        [connectionApp("existing", "gmail", "old"), connectionApp("new", "gmail", "new")],
        operation,
      ),
    ).toEqual({
      connectionName: "new",
      service: "gmail",
      workspaceKey: "team:team-name",
    })
  })

  it("resolves the requested account when OAuth reconnects", () => {
    const operation = createOAuthPendingOperation(
      { teamName: "team-name" },
      { appId: "target", authType: "oauth2", service: "gmail" },
      1,
      1_000,
    )

    expect(
      resolveOAuthConnectionReadyTarget(
        [connectionApp("other", "gmail", "other"), connectionApp("target", "gmail", "target")],
        operation,
      ),
    ).toEqual({
      connectionName: "target",
      service: "gmail",
      workspaceKey: "team:team-name",
    })
  })
})
