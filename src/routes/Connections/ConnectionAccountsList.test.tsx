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
})
