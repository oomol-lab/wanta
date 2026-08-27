// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest"
import {
  clearPersistentConnectionAppsCache,
  invalidatePersistentWorkspaceApps,
  readPersistentConnectorCache,
  writePersistentConnectorCache,
} from "./connections-persistent-cache.ts"

const managementWorkspace = { manageable: true, teamName: "acme" } as const
const runtimeWorkspace = { manageable: false, teamName: "acme" } as const
const entry = {
  data: [{ credentialFields: [{ key: "token", displayValue: "secret" }], id: "app-1", service: "github" }],
  etag: '"apps-v1"',
  lastModified: "Wed, 26 Aug 2026 12:00:00 GMT",
  meta: { summary: { providerCount: 1 } },
}

describe("persistent connector cache", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it("stores public provider catalogs in localStorage with locale isolation", () => {
    const providers = { data: [{ service: "github" }], etag: '"providers-v1"', meta: null }
    writePersistentConnectorCache("/v1/providers?locale=en", null, providers)

    expect(readPersistentConnectorCache("/v1/providers?locale=en", null)).toEqual(providers)
    expect(readPersistentConnectorCache("/v1/providers?locale=zh-CN", null)).toBeNull()
    expect(localStorage.length).toBe(1)
    expect(sessionStorage.length).toBe(0)
  })

  it("stores app inventories in sessionStorage with workspace and access-mode isolation", () => {
    writePersistentConnectorCache("/v1/connections", managementWorkspace, entry)
    writePersistentConnectorCache("/v1/apps", runtimeWorkspace, {
      ...entry,
      data: [{ id: "visible-1", service: "gmail" }],
    })

    expect(readPersistentConnectorCache("/v1/connections", managementWorkspace)?.data).toEqual([
      expect.not.objectContaining({ credentialFields: expect.anything() }),
    ])
    expect(readPersistentConnectorCache("/v1/apps", runtimeWorkspace)?.data).toEqual([
      { id: "visible-1", service: "gmail" },
    ])
    expect(readPersistentConnectorCache("/v1/apps", managementWorkspace)).toBeNull()
    expect(sessionStorage.length).toBe(2)
  })

  it("invalidates only the selected workspace and clears every account-scoped app cache", () => {
    const otherWorkspace = { manageable: true, teamName: "other" } as const
    writePersistentConnectorCache("/v1/connections", managementWorkspace, entry)
    writePersistentConnectorCache("/v1/connections", otherWorkspace, entry)
    writePersistentConnectorCache("/v1/providers?locale=en", null, {
      data: [{ service: "github" }],
      meta: null,
    })

    invalidatePersistentWorkspaceApps(managementWorkspace)
    expect(readPersistentConnectorCache("/v1/connections", managementWorkspace)).toBeNull()
    expect(readPersistentConnectorCache("/v1/connections", otherWorkspace)).not.toBeNull()

    clearPersistentConnectionAppsCache()
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(1)
  })

  it("ignores malformed, sensitive-detail, and unsupported cache entries", () => {
    writePersistentConnectorCache("/v1/connections/by-id/app-1", managementWorkspace, entry)
    writePersistentConnectorCache("/v1/providers?locale=en", null, { data: [{ token: "secret" }], meta: null })
    localStorage.setItem("wanta:connections:providers:v1:bad", "not-json")

    expect(readPersistentConnectorCache("/v1/connections/by-id/app-1", managementWorkspace)).toBeNull()
    expect(readPersistentConnectorCache("/v1/providers?locale=en", null)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
})
