// @vitest-environment happy-dom

import type { ComponentProps } from "react"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentConfigurationPicker } from "./AgentConfigurationPicker.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseProps: ComponentProps<typeof AgentConfigurationPicker> = {
  agentEffortSelectionEnabled: false,
  agentKind: "opencode",
  agentModelSelectionEnabled: false,
  composerDisabled: false,
  externalAgents: [
    {
      binary: { path: "/usr/bin/claude", status: "detected", version: "2.0.0" },
      displayName: "Claude Code",
      kind: "claude-code",
      login: { status: "logged_out" },
      loginHint: "Run claude login",
    },
    {
      binary: { path: "/usr/bin/codex", status: "detected", version: "1.0.0" },
      catalog: {
        defaultEffortId: "high",
        defaultModelId: "gpt-default",
        efforts: [
          { id: "high", label: "High" },
          { id: "max", label: "Max" },
        ],
        models: [
          { id: "gpt-default", label: "GPT Default" },
          { id: "gpt-next", label: "GPT Next" },
        ],
      },
      displayName: "Codex",
      kind: "codex",
      login: { status: "logged_in" },
      loginHint: "Run codex login",
    },
    {
      binary: { status: "not_found" },
      displayName: "Grok",
      kind: "grok",
      login: { status: "unknown" },
      loginHint: "Run grok login",
    },
  ],
  modelCatalog: null,
  modelRequired: false,
  modelRoutingEnabled: true,
  reasoningLevel: "default",
  onAddModel: vi.fn(),
  onDeleteModel: vi.fn(),
  onSelectModel: vi.fn(),
  onSelectReasoningLevel: vi.fn(),
}

const roots: Array<ReturnType<typeof createRoot>> = []

async function renderPicker(overrides: Partial<ComponentProps<typeof AgentConfigurationPicker>> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{
          locale: "en",
          setLocale: () => undefined,
          t: (key, vars) => translate("en", key, vars),
        }}
      >
        <AgentConfigurationPicker {...baseProps} {...overrides} />
      </I18nContext.Provider>,
    )
  })
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Agent configuration"]')
  await act(async () => trigger?.click())
  return { host, root, trigger }
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(text),
  )
}

function buttonWithTexts(...texts: string[]): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    texts.every((text) => button.textContent?.includes(text)),
  )
}

async function hoverButton(text: string) {
  const menuItem = [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find((button) =>
    button.textContent?.includes(text),
  )
  await act(async () => menuItem?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe("AgentConfigurationPicker", () => {
  it("keeps the selected agent visible in the closed trigger even when Wanta owns the model", async () => {
    const builtIn = await renderPicker()
    expect(builtIn.trigger?.textContent).toBe("Built-in Agent · Auto · Default")
    expect(builtIn.trigger?.querySelector('[title="wanta"]')).not.toBeNull()

    const claude = await renderPicker({ agentKind: "claude-code" })
    expect(claude.trigger?.textContent).toBe("Claude Code · Auto · Default")
    expect(claude.trigger?.querySelector('[title="claude-code"]')).not.toBeNull()
  })

  it("groups agent, Wanta model, and reasoning in one portaled panel", async () => {
    const { host } = await renderPicker()
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Agent configuration"]')

    expect(menu).not.toBeNull()
    expect(host.contains(menu)).toBe(false)
    expect(menu?.textContent).toContain("Built-in Agent")
    expect(menu?.textContent).toContain("Auto")
    expect(menu?.textContent).toContain("Default")
    const rootRows = [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map(
      (button) => button.textContent,
    )
    expect(rootRows).toEqual(["ModelAuto", "ReasoningDefault", "AgentBuilt-in Agent"])
    expect(rootRows).toHaveLength(3)
    for (const row of menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []) {
      expect(row.getAttribute("aria-haspopup")).toBe("menu")
      expect(row.getAttribute("aria-expanded")).toBe("false")
    }
    expect(menu?.querySelectorAll("svg")).toHaveLength(3)
    expect(document.querySelector("button button")).toBeNull()
  })

  it("selects a BYOA agent from the same configuration panel", async () => {
    const onSelectAgentKind = vi.fn()
    await renderPicker({ onSelectAgentKind })

    await hoverButton("Built-in Agent")
    expect(document.body.textContent).toContain("Codex")
    await act(async () => buttonWithText("Codex")?.click())

    expect(onSelectAgentKind).toHaveBeenCalledWith("codex")
  })

  it("keeps detected agents selectable and disables only undetected agents", async () => {
    const onSelectAgentKind = vi.fn()
    await renderPicker({ onSelectAgentKind })

    await hoverButton("Built-in Agent")
    const claude = buttonWithText("Claude Code")
    const codex = buttonWithText("Codex")
    const grok = buttonWithText("Grok")
    expect(claude?.disabled).toBe(false)
    expect(codex?.disabled).toBe(false)
    expect(grok?.disabled).toBe(true)
    expect(buttonWithTexts("Built-in Agent", `OpenCode ${__OPENCODE_VERSION__}`)).toBeDefined()
    expect(buttonWithTexts("Claude Code", "2.0.0")).toBeDefined()
    expect(buttonWithTexts("Codex", "1.0.0")).toBeDefined()
    expect(buttonWithTexts("Grok", "Not detected")).toBeDefined()
    expect(codex?.querySelectorAll(".block")).toHaveLength(0)
    await act(async () => codex?.click())
    expect(onSelectAgentKind).toHaveBeenCalledWith("codex")
  })

  it("routes external model and effort choices through BYOA callbacks", async () => {
    const onSelectAgentEffort = vi.fn()
    const onSelectAgentModel = vi.fn()
    const { trigger } = await renderPicker({
      agentCatalog: baseProps.externalAgents[1]?.catalog,
      agentEffortSelectionEnabled: true,
      agentKind: "codex",
      agentModelSelectionEnabled: true,
      modelRoutingEnabled: false,
      onSelectAgentEffort,
      onSelectAgentModel,
    })

    await hoverButton("Model")
    await act(async () => buttonWithText("GPT Next")?.click())
    expect(onSelectAgentModel).toHaveBeenCalledWith("gpt-next")

    await act(async () => trigger?.click())
    await hoverButton("Reasoning effort")
    await act(async () => buttonWithText("Max")?.click())
    expect(onSelectAgentEffort).toHaveBeenCalledWith("max")
  })

  it("maps the external Default model row back to an undefined selection", async () => {
    const onSelectAgentModel = vi.fn()
    await renderPicker({
      agentCatalog: baseProps.externalAgents[1]?.catalog,
      agentKind: "codex",
      agentModelId: "gpt-next",
      agentModelSelectionEnabled: true,
      modelRoutingEnabled: false,
      onSelectAgentModel,
    })

    await hoverButton("Model")
    await act(async () => buttonWithText("Default")?.click())

    expect(onSelectAgentModel).toHaveBeenCalledWith(undefined)
  })

  it("hides a stale effort value when the selected agent does not support effort selection", async () => {
    const { host } = await renderPicker({
      agentEffortId: "stale-effort",
      agentEffortSelectionEnabled: false,
      agentKind: "grok",
      modelRoutingEnabled: false,
    })

    expect(host.querySelector('[aria-label="Agent configuration"]')?.textContent).toBe("Grok")
  })
})
