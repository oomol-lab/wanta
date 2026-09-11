// @vitest-environment happy-dom
import type { AgentKind } from "../../electron/agent/contract/profile.ts"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { useExternalAgentCatalog } from "./useExternalAgentCatalog.ts"
const { service } = vi.hoisted(() => ({ service: { invoke: vi.fn() } }))
vi.mock("@/components/AppContext", () => ({ useChatService: () => service }))
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
afterEach(() => vi.clearAllMocks())
async function mount() {
  let view!: ReturnType<typeof useExternalAgentCatalog>
  function Probe({ kind, model }: { kind: AgentKind; model?: string }) {
    view = useExternalAgentCatalog(kind, model)
    return null
  }
  const root = createRoot(document.createElement("div"))
  return {
    view: () => view,
    render: (kind: AgentKind, model?: string) => act(async () => root.render(<Probe kind={kind} model={model} />)),
    dispose: () => act(async () => root.unmount()),
  }
}
test("model changes clear old choices and ignore out-of-order replies", async () => {
  const completions: Array<(value: unknown) => void> = []
  service.invoke.mockImplementation(() => new Promise((resolve) => completions.push(resolve)))
  const probe = await mount()
  try {
    await probe.render("codex", "model-a")
    await probe.render("codex", "model-b")
    expect(probe.view().loading).toBe(true)
    expect(probe.view().catalog).toBeUndefined()
    await act(async () => completions[1]!({ models: [], efforts: [{ id: "high", label: "High" }] }))
    await act(async () => completions[0]!({ models: [], efforts: [{ id: "low", label: "Low" }] }))
    expect(probe.view().catalog?.efforts.map((x) => x.id)).toEqual(["high"])
    expect(service.invoke).toHaveBeenLastCalledWith("previewExternalAgentCatalog", {
      kind: "codex",
      modelId: "model-b",
    })
  } finally {
    await probe.dispose()
  }
})
test("failed discovery can be retried and never falls back to another agent's catalog", async () => {
  service.invoke.mockRejectedValueOnce(new Error("Authentication required"))
  const probe = await mount()
  try {
    await probe.render("grok")
    expect(probe.view().error).toBe(true)
    expect(probe.view().loading).toBe(false)
    service.invoke.mockResolvedValueOnce({ models: [], efforts: [{ id: "medium", label: "Medium" }] })
    await act(async () => probe.view().refresh())
    expect(probe.view().error).toBe(false)
    expect(probe.view().catalog?.efforts).toHaveLength(1)
    await probe.render("opencode")
    expect(probe.view().catalog).toBeUndefined()
    expect(probe.view().loading).toBe(false)
    expect(service.invoke).toHaveBeenCalledTimes(2)
  } finally {
    await probe.dispose()
  }
})
