import { describe, expect, test } from "vitest"
import {
  projectSidebarCollapsedStorageKey,
  pruneCollapsedProjectIds,
  readStoredCollapsedProjectIds,
  readStoredSidebarCollapsed,
  readStoredSidebarSegment,
  writeStoredCollapsedProjectIds,
  writeStoredSidebarCollapsed,
  writeStoredSidebarSegment,
} from "./sidebar-persistence.ts"

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  private readonly values = new Map<string, string>()

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  public removeItem(key: string): void {
    this.values.delete(key)
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe("sidebar persistence", () => {
  test("reads sidebar segment with tasks as the fallback", () => {
    const storage = new MemoryStorage()

    expect(readStoredSidebarSegment(storage)).toBe("tasks")
    writeStoredSidebarSegment(storage, "projects")
    expect(readStoredSidebarSegment(storage)).toBe("projects")
    storage.setItem("wanta.sidebarSegment", "invalid")
    expect(readStoredSidebarSegment(storage)).toBe("tasks")
  })

  test("stores explicit sidebar collapse preference", () => {
    const storage = new MemoryStorage()

    expect(readStoredSidebarCollapsed(storage)).toBe(false)
    writeStoredSidebarCollapsed(storage, true)
    expect(readStoredSidebarCollapsed(storage)).toBe(true)
    writeStoredSidebarCollapsed(storage, false)
    expect(readStoredSidebarCollapsed(storage)).toBe(false)
  })

  test("scopes collapsed project groups by account and workspace", () => {
    expect(
      projectSidebarCollapsedStorageKey(undefined, {
        teamId: "team-id",
        teamName: "team-name",
      }),
    ).toBeNull()
    expect(projectSidebarCollapsedStorageKey("account-a", null)).toBeNull()
    expect(
      projectSidebarCollapsedStorageKey("account-a", {
        teamId: "team-id",
        teamName: "team-name",
      }),
    ).toBe("wanta.projectSidebarCollapsed:account-a:team:team-id")
    expect(
      projectSidebarCollapsedStorageKey("account-a", {
        teamId: "team-a",
        teamName: "Team A",
      }),
    ).toBe("wanta.projectSidebarCollapsed:account-a:team:team-a")
  })

  test("reads, writes, removes, and prunes collapsed project ids", () => {
    const storage = new MemoryStorage()
    const key = "wanta.projectSidebarCollapsed:account-a:team:team-id"

    expect(readStoredCollapsedProjectIds(storage, key)).toEqual(new Set())
    writeStoredCollapsedProjectIds(storage, key, new Set(["project-b", "project-a"]))
    expect(storage.getItem(key)).toBe('["project-a","project-b"]')
    expect(readStoredCollapsedProjectIds(storage, key)).toEqual(new Set(["project-a", "project-b"]))

    expect(pruneCollapsedProjectIds(new Set(["project-a", "missing"]), new Set(["project-a"]))).toEqual(
      new Set(["project-a"]),
    )
    writeStoredCollapsedProjectIds(storage, key, new Set())
    expect(storage.getItem(key)).toBeNull()
  })

  test("ignores invalid collapsed project records", () => {
    const storage = new MemoryStorage()
    const key = "wanta.projectSidebarCollapsed:account-a:team:team-id"

    storage.setItem(key, '{"project-a":true}')
    expect(readStoredCollapsedProjectIds(storage, key)).toEqual(new Set())
    storage.setItem(key, '["project-a", "", 42, "project-b"]')
    expect(readStoredCollapsedProjectIds(storage, key)).toEqual(new Set(["project-a", "project-b"]))
  })

  test("migrates legacy organization-scoped collapsed project ids", () => {
    const storage = new MemoryStorage()
    const key = "wanta.projectSidebarCollapsed:account-a:team:team-id"
    const legacyKey = "wanta.projectSidebarCollapsed:account-a:organization:team-id"
    storage.setItem(legacyKey, '["project-a"]')

    expect(readStoredCollapsedProjectIds(storage, key)).toEqual(new Set(["project-a"]))
    expect(storage.getItem(key)).toBe('["project-a"]')
    expect(storage.getItem(legacyKey)).toBeNull()
  })

  test("retains the legacy collapsed-project key when migration cannot be written", () => {
    const values = new Map<string, string>()
    const key = "wanta.projectSidebarCollapsed:account-a:team:team-id"
    const legacyKey = "wanta.projectSidebarCollapsed:account-a:organization:team-id"
    values.set(legacyKey, '["project-a"]')
    const storage = {
      getItem: (storageKey: string) => values.get(storageKey) ?? null,
      removeItem: (storageKey: string) => void values.delete(storageKey),
      setItem: () => {
        throw new Error("quota exceeded")
      },
    }

    expect(readStoredCollapsedProjectIds(storage, key)).toEqual(new Set(["project-a"]))
    expect(values.get(legacyKey)).toBe('["project-a"]')
    expect(values.has(key)).toBe(false)
  })
})
