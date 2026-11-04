// @vitest-environment happy-dom

import type { ConnectionProviderDetail } from "../../../electron/connections/common.ts"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { ConnectDialog } from "./ConnectDialog.tsx"
import { I18nContext, translate } from "@/i18n/i18n"
import * as connectionsClient from "@/lib/connections-client"

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

test("submits an Investoday URL as the extracted API key", async () => {
  const onSubmit = vi.fn()
  const root = await render(
    <ConnectDialog
      open
      authType="api_key"
      busy={false}
      detail={{
        ...detail,
        service: "investoday_mcp",
        authTypes: ["api_key"],
        actionKind: "api_key",
        oauthClientConfig: null,
      }}
      onClose={() => undefined}
      onOpenUrl={() => undefined}
      onSubmit={onSubmit}
    />,
  )
  const input = document.querySelector<HTMLInputElement>('input[type="password"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "https://data-api.investoday.net/data/mcp?apiKey=test%2Fkey",
    )
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === translate("en", "connections.saveConnection"),
  )!
  expect(save.disabled).toBe(false)
  await act(async () => save.click())
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ service: "investoday_mcp", apiKey: "test/key" }))
  act(() => root.unmount())
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
      authorizationOptionIds: ["account.read", "documents.read", "documents.delete"],
      authType: "oauth2",
      service: "documents",
    }),
  )

  act(() => root.unmount())
})

test("preserves unmanaged scopes when reconnecting", async () => {
  const onSubmit = vi.fn()
  const root = await render(
    <ConnectDialog
      open
      appId="app-1"
      appDetail={{
        authType: "oauth2",
        createdAt: 0,
        id: "app-1",
        isDefault: true,
        scopes: ["account.read", "legacy.scope"],
        service: "documents",
        status: "active",
        updatedAt: 0,
      }}
      authType="oauth2"
      busy={false}
      detail={detail}
      onClose={() => undefined}
      onOpenUrl={() => undefined}
      onSubmit={onSubmit}
    />,
  )
  const reconnect = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Reconnect",
  )

  expect(document.body.textContent).not.toContain("Will remove: legacy.scope")
  await act(async () => reconnect?.click())
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      authorizationOptionIds: ["account.read", "legacy.scope"],
      authType: "oauth2",
    }),
  )

  act(() => root.unmount())
})

test.each([true, false])("删除 OAuth 配置成功=%s 时正确更新表单和授权状态", async (success) => {
  const request = vi.spyOn(connectionsClient, "deleteOAuthClientConfig")
  if (success) request.mockResolvedValue()
  else request.mockRejectedValue(new Error("Delete failed"))
  const root = await render(
    <ConnectDialog
      open
      authType="oauth2"
      busy={false}
      detail={{ ...detail, oauthClientConfig: { ...detail.oauthClientConfig!, clientConfigPolicy: "user_required" } }}
      oauthClientConfig={{
        service: "documents",
        clientConfigPolicy: "user_required",
        clientId: "saved-client",
        configured: true,
        nextConnectSource: "custom",
        expectedRedirectUri: null,
        tokenEndpointAuthMethod: "none",
        clientConfigFields: [],
      }}
      onClose={() => undefined}
      onSubmit={() => undefined}
      onOpenUrl={() => undefined}
    />,
  )
  const findDelete = () =>
    [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Delete config"))
  expect(findDelete()).toBeDefined()
  await act(async () => findDelete()!.click())
  expect(request).toHaveBeenCalledWith("documents")
  expect(Boolean(findDelete())).toBe(!success)
  expect([...document.querySelectorAll("input")].some((input) => input.value === "saved-client")).toBe(!success)
  await act(async () => root.unmount())
})
