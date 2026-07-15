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
} from "./connection-oauth-pending.ts"

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
    const workspace = { organizationName: "org-name" } as const

    expect(createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" })).toBe(
      createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" }),
    )
    expect(createOAuthPendingKey(workspace, { authType: "oauth2", service: "gmail" })).not.toBe(
      createOAuthPendingKey(workspace, { appId: "app-1", authType: "oauth2", service: "gmail" }),
    )
  })

  it("separates services and organization workspaces", () => {
    const orgGmail = createOAuthPendingKey({ organizationName: "org-name" }, { authType: "oauth2", service: "gmail" })
    const orgSlack = createOAuthPendingKey({ organizationName: "org-name" }, { authType: "oauth2", service: "slack" })
    const organizationGmail = createOAuthPendingKey(
      { organizationName: "acme" },
      { authType: "oauth2", service: "gmail" },
    )

    expect(orgGmail).not.toBe(orgSlack)
    expect(orgGmail).not.toBe(organizationGmail)
  })

  it("shares workspace and polling key formatting helpers", () => {
    expect(connectionWorkspaceKey({ organizationName: "org-name" })).toBe("organization:org-name")
    expect(connectionWorkspaceKey({ organizationName: "acme" })).toBe("organization:acme")
    expect(createConnectionPollingKey("gmail")).toBe("gmail")
    expect(createConnectionPollingKey("gmail", "app-1")).toBe("gmail\0app-1")
    expect(isConnectionPollingTarget("gmail\0app-1", "gmail", "app-1")).toBe(true)
    expect(isConnectionPollingTarget("gmail\0app-1", "gmail", "app-2")).toBe(false)
    expect(isConnectionServicePollingTarget("gmail\0app-1", "gmail")).toBe(true)
    expect(isConnectionServicePollingTarget("slack\0app-1", "gmail")).toBe(false)
  })

  it("stores pending OAuth operations until they expire", () => {
    const workspace = { organizationName: "org-name" } as const
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
      workspaceKey: "organization:org-name",
    })
    expect(readOAuthPendingOperation(operation.key, operation.expiresAt, storage)).toBeNull()
  })

  it("keeps only one pending OAuth operation per workspace", () => {
    const orgName = { organizationName: "org-name" } as const
    const organization = { organizationName: "acme" } as const
    const first = createOAuthPendingOperation(orgName, { authType: "oauth2", service: "gmail" }, 1, 1_000)
    const second = createOAuthPendingOperation(orgName, { authType: "oauth2", service: "slack" }, 2, 2_000)
    const otherWorkspace = createOAuthPendingOperation(organization, { authType: "oauth2", service: "gmail" }, 3, 3_000)

    rememberOAuthPendingOperation(first, storage)
    rememberOAuthPendingOperation(second, storage)
    rememberOAuthPendingOperation(otherWorkspace, storage)

    expect(readOAuthPendingOperationsForWorkspace(orgName, 3_000, storage)).toEqual([second])
    expect(readOAuthPendingOperationsForWorkspace(organization, 3_000, storage)).toEqual([otherWorkspace])
  })
})
