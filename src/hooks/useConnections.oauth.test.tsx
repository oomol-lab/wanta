// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { useConnections } from "./useConnections.ts"
import { clearConnectorCache } from "@/lib/connections-client"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (_method: string, _payload?: unknown) => {}) }))
vi.mock("../components/AppContext.ts", () => ({ useChatService: () => ({ invoke }) }))
vi.mock("../i18n/i18n.ts", () => ({ useI18n: () => ({ locale: "en" }) }))

test("OAuth direct completion refreshes accounts without opening a browser or polling", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  let connected = false
  const app = { id: "app-1", service: "gmail", status: "active", authType: "oauth2" }
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith("/connect") && init?.method === "POST") {
      connected = true
      return Response.json({ data: { app } })
    }
    return Response.json({ data: path === "/v1/providers" ? [] : connected ? [app] : [] })
  })
  vi.stubGlobal("fetch", fetcher)
  let view!: ReturnType<typeof useConnections>
  const workspace = { teamName: "acme", manageable: true }
  function Probe() {
    view = useConnections(workspace)
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    let result: boolean | undefined
    await act(async () => {
      result = await view.connect({ service: "gmail", authType: "oauth2" })
    })
    expect(result).toBe(true)
    expect(view.summary?.apps).toEqual([expect.objectContaining({ id: "app-1" })])
    expect(view.polling).toBeNull()
    expect(view.actionError).toBeNull()
    expect(view.connectionReadyEvent).toMatchObject({ service: "gmail" })
    expect(invoke.mock.calls.some(([method]) => method === "openExternalUrl")).toBe(false)
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/v1/connections"))).toHaveLength(3)
  } finally {
    await act(async () => root.unmount())
    clearConnectorCache()
    vi.unstubAllGlobals()
  }
})
