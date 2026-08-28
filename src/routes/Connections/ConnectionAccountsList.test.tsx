// @vitest-environment happy-dom

import type { ConnectionAppSummary, ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { UseConnections } from "@/hooks/useConnections"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConnectionAccountsList } from "./ConnectionAccountsList.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const app: ConnectionAppSummary = {
  authType: null,
  createdAt: 1,
  id: "app-1",
  isDefault: true,
  service: "github",
  status: "active",
  updatedAt: 1,
}

const provider: ConnectionProviderSummary = {
  actionKind: "oauth2",
  appCount: 1,
  apps: [app],
  authTypes: ["oauth2"],
  canDisconnect: false,
  categoryLabels: [],
  displayName: "GitHub",
  service: "github",
  status: "connected",
}

function listElement(onOpenAccess: (target: ConnectionAppSummary) => void): React.ReactElement {
  return React.createElement(ConnectionAccountsList, {
    accessContext: {} as never,
    busy: null,
    canManageConnections: false,
    connections: {} as UseConnections,
    onConnect: async () => undefined,
    onDisconnect: () => undefined,
    onOpenAccess,
    polling: null,
    provider,
  })
}

async function renderDuplicatedLists(onOpenAccess: (target: ConnectionAppSummary) => void): Promise<Root> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{ locale: "en", setLocale: () => undefined, t: (key, vars) => translate("en", key, vars) }}
      >
        {listElement(onOpenAccess)}
        {listElement(onOpenAccess)}
      </I18nContext.Provider>,
    )
  })
  return root
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("ConnectionAccountsList access dialog ownership", () => {
  it("delegates access opening without mounting a modal from duplicated responsive lists", async () => {
    const onOpenAccess = vi.fn()
    const root = await renderDuplicatedLists(onOpenAccess)
    const accessButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
      (button) => button.textContent?.trim() === "View access",
    )

    expect(accessButtons).toHaveLength(2)
    await act(async () => accessButtons[0]?.click())

    expect(onOpenAccess).toHaveBeenCalledOnce()
    expect(onOpenAccess).toHaveBeenCalledWith(app)
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(0)

    act(() => root.unmount())
  })

  it("shows Marketplace identity and default selection without credential mutations", async () => {
    const marketplaceApp: ConnectionAppSummary = {
      authType: "api_key",
      createdAt: 0,
      id: "marketplace:oomol:tikhub",
      isDefault: false,
      marketplace: { id: "oomol", pricing: "metered" },
      service: "tikhub",
      status: "active",
      updatedAt: 0,
    }
    const marketplaceProvider: ConnectionProviderSummary = {
      actionKind: "api_key",
      appAuthType: "marketplace",
      appCount: 1,
      appId: marketplaceApp.id,
      apps: [marketplaceApp],
      authTypes: ["api_key"],
      canDisconnect: false,
      categoryLabels: [],
      displayName: "TikHub",
      service: "tikhub",
      status: "connected",
    }
    const setDefaultConnection = vi.fn(async () => true)
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "en", setLocale: () => undefined, t: (key, vars) => translate("en", key, vars) }}
        >
          <ConnectionAccountsList
            accessContext={{} as never}
            busy={null}
            canManageConnections
            connections={{ setDefaultConnection } as unknown as UseConnections}
            onConnect={async () => undefined}
            onDisconnect={() => undefined}
            onOpenAccess={() => undefined}
            polling={null}
            provider={marketplaceProvider}
          />
        </I18nContext.Provider>,
      )
    })

    expect(host.textContent).toContain("OOMOL built-in account")
    expect(host.textContent).toContain("OOMOL managed")
    expect(host.textContent).toContain("Uses OOMOL Credits")
    expect(host.textContent).toContain("Set as default")
    expect(host.textContent).not.toContain("Reconnect")
    expect(host.textContent).not.toContain("Disconnect")
    expect(host.querySelector('[aria-label="Edit connection name"]')).toBeNull()

    const setDefaultButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Set as default"),
    )
    await act(async () => setDefaultButton?.click())
    expect(setDefaultConnection).toHaveBeenCalledWith("tikhub", marketplaceApp.id)

    act(() => root.unmount())
  })

  it("switches a Marketplace default back to a user connection without a metered label for free usage", async () => {
    const marketplaceApp: ConnectionAppSummary = {
      authType: "marketplace",
      createdAt: 0,
      id: "marketplace:oomol:tinypng",
      isDefault: true,
      marketplace: { id: "oomol", pricing: "free" },
      service: "tinypng",
      status: "active",
      updatedAt: 0,
    }
    const userApp: ConnectionAppSummary = {
      accountLabel: "My TinyPNG key",
      authType: "api_key",
      createdAt: 1,
      id: "app-user-key",
      isDefault: false,
      service: "tinypng",
      status: "active",
      updatedAt: 2,
    }
    const setDefaultConnection = vi.fn(async () => true)
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <I18nContext.Provider
          value={{ locale: "en", setLocale: () => undefined, t: (key, vars) => translate("en", key, vars) }}
        >
          <ConnectionAccountsList
            busy={null}
            canManageConnections
            connections={{ setDefaultConnection } as unknown as UseConnections}
            onConnect={async () => undefined}
            onDisconnect={() => undefined}
            onOpenAccess={() => undefined}
            polling={null}
            provider={{
              actionKind: "api_key",
              appAuthType: "marketplace",
              appCount: 2,
              appId: marketplaceApp.id,
              apps: [marketplaceApp, userApp],
              authTypes: ["api_key"],
              canDisconnect: true,
              categoryLabels: [],
              displayName: "TinyPNG",
              service: "tinypng",
              status: "connected",
            }}
          />
        </I18nContext.Provider>,
      )
    })

    expect(host.textContent).not.toContain("Uses OOMOL Credits")
    const setDefaultButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Set as default"),
    )
    await act(async () => setDefaultButton?.click())
    expect(setDefaultConnection).toHaveBeenCalledWith("tinypng", userApp.id)

    act(() => root.unmount())
  })
})
