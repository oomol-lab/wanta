// @vitest-environment happy-dom
import type { UseLinkRuntime } from "@/hooks/useLinkRuntime"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { OpenConnectorConnectionsPanel } from "./OpenConnectorConnectionsPanel.tsx"

vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: (key: string) => key }) }))

test("inventory renders before health finishes and manual refresh bypasses cached reads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div")
  const root = createRoot(host)
  let releaseHealth!: (status: UseLinkRuntime["status"]) => void
  const health = new Promise<UseLinkRuntime["status"]>((resolve) => {
    releaseHealth = resolve
  })
  const listOpenConnectorApps = vi.fn(async () => [
    {
      service: "gmail",
      displayName: "Work Gmail",
      connectionName: "work",
      authType: "oauth2",
      status: "active" as const,
      isDefault: true,
    },
  ])
  const refreshStatus = vi.fn(() => health)
  const runtime = {
    state: {
      selected: "openconnector",
      active: "openconnector",
      availability: { oomol: false, openconnector: true },
      openConnector: {
        baseUrl: "https://connector.example.test",
        consoleUrl: "https://console.example.test",
        tokenConfigured: false,
      },
    },
    status: { kind: "unknown" },
    listOpenConnectorApps,
    refreshStatus,
  } satisfies Pick<UseLinkRuntime, "state" | "status" | "listOpenConnectorApps" | "refreshStatus">
  try {
    await act(async () =>
      root.render(<OpenConnectorConnectionsPanel runtime={runtime} onOpenSettings={() => undefined} />),
    )
    expect(refreshStatus).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain("Work Gmail")
    expect(host.textContent).not.toContain("connections.openConnector.loading")
    const refreshButton = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("connections.openConnector.refresh"),
    )!
    expect(refreshButton.disabled).toBe(false)
    await act(async () => refreshButton.click())
    expect(refreshStatus).toHaveBeenLastCalledWith({ forceRefresh: true })
    expect(listOpenConnectorApps).toHaveBeenLastCalledWith({ forceRefresh: true })
  } finally {
    releaseHealth({ kind: "online", checkedAt: Date.now() })
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
