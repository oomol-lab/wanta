// @vitest-environment happy-dom

import type { ConnectionProviderDetail } from "../../../electron/connections/common.ts"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const detail: ConnectionProviderDetail = {
  actionKind: "oauth2",
  appCount: 0,
  apps: [],
  authTypes: ["oauth2"],
  canDisconnect: false,
  categoryLabels: ["Documentation"],
  customCredentialConfig: null,
  displayName: "Documents",
  federatedCredentialConfig: null,
  apiKeyConfig: null,
  oauthClientConfig: {
    authorizationOptions: [
      {
        defaultSelected: false,
        description: "Read account details.",
        id: "account.read",
        label: "Account",
        required: true,
        requires: [],
        risk: "standard",
      },
      {
        defaultSelected: true,
        description: "Read documents.",
        id: "documents.read",
        label: "Read documents",
        required: false,
        requires: ["account.read"],
        risk: "standard",
      },
      {
        defaultSelected: false,
        description: "Delete documents.",
        id: "documents.delete",
        label: "Delete documents",
        required: false,
        requires: ["documents.read"],
        risk: "destructive",
      },
    ],
    clientConfigFields: [],
    clientConfigPolicy: "default_only",
    configured: true,
    nextConnectSource: "default",
    oauthScopes: [],
    service: "documents",
    tokenEndpointAuthMethod: "none",
  },
  service: "documents",
  status: "available",
}

async function render(element: React.ReactElement): Promise<Root> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{ locale: "en", setLocale: () => undefined, t: (key, vars) => translate("en", key, vars) }}
      >
        {element}
      </I18nContext.Provider>,
    )
  })
  return root
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

test("submits selected OAuth authorization options and warns about destructive access", async () => {
  const onSubmit = vi.fn()
  const root = await render(
    <ConnectDialog
      open
      authType="oauth2"
      busy={false}
      detail={detail}
      onClose={() => undefined}
      onOpenUrl={() => undefined}
      onSubmit={onSubmit}
    />,
  )
  const checkboxes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="checkbox"]'))

  expect(checkboxes).toHaveLength(3)
  expect(checkboxes[0]?.disabled).toBe(true)
  expect(document.body.textContent).not.toContain("Destructive access selected")
  await act(async () => checkboxes[2]?.click())
  expect(document.body.textContent).toContain("Destructive access selected")

  const connect = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Connect",
  )
  await act(async () => connect?.click())
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      authorizationScopes: ["account.read", "documents.read", "documents.delete"],
      authType: "oauth2",
      service: "documents",
    }),
  )

  act(() => root.unmount())
})
