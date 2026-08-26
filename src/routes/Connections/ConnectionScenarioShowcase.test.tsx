// @vitest-environment happy-dom

import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { ConnectionDiscoveryCategoryHeader, ConnectionScenarioShowcase } from "./ConnectionScenarioShowcase.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

function provider(overrides: Partial<ConnectionProviderSummary>): ConnectionProviderSummary {
  return {
    actionKind: "oauth2",
    appCount: 0,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: false,
    categoryLabels: [],
    displayName: "Provider",
    service: "provider",
    status: "available",
    ...overrides,
  }
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

test("category cards navigate into a discovery category instead of acting as toggles", async () => {
  const onSelect = vi.fn()
  const root = await render(
    <ConnectionScenarioShowcase
      providers={[provider({ categoryLabels: ["AI"], displayName: "OpenAI", service: "openai" })]}
      onSelect={onSelect}
    />,
  )
  const card = document.querySelector<HTMLButtonElement>('button[aria-label="View AI & agents connectors"]')

  expect(card?.getAttribute("aria-pressed")).toBeNull()
  expect(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="View "]')).toHaveLength(8)
  expect(document.body.textContent).toContain("Development & cloud")
  await act(async () => card?.click())
  expect(onSelect).toHaveBeenCalledWith("ai")

  act(() => root.unmount())
})

test("empty discovery categories remain available in the stable eight-category layout", async () => {
  const onSelect = vi.fn()
  const root = await render(<ConnectionScenarioShowcase providers={[]} onSelect={onSelect} />)
  const cards = document.querySelectorAll<HTMLButtonElement>('button[aria-label^="View "]')
  const developerCard = document.querySelector<HTMLButtonElement>(
    'button[aria-label="View Development & cloud connectors"]',
  )

  expect(cards).toHaveLength(8)
  expect(developerCard?.textContent).toContain("0")
  await act(async () => developerCard?.click())
  expect(onSelect).toHaveBeenCalledWith("developer")

  act(() => root.unmount())
})

test("category card counts use stable ids when labels are localized", async () => {
  const root = await render(
    <ConnectionScenarioShowcase
      providers={[
        provider({ categoryIds: ["ai"], categoryLabels: ["人工智能"], service: "openai" }),
        provider({ categoryIds: ["developer"], categoryLabels: ["开发工具"], service: "github" }),
      ]}
      onSelect={() => undefined}
    />,
  )
  const aiCard = document.querySelector<HTMLButtonElement>('button[aria-label="View AI & agents connectors"]')
  const developerCard = document.querySelector<HTMLButtonElement>(
    'button[aria-label="View Development & cloud connectors"]',
  )

  expect(aiCard?.textContent).toContain("1")
  expect(developerCard?.textContent).toContain("1")

  act(() => root.unmount())
})

test("category detail exposes an explicit back action", async () => {
  const onBack = vi.fn()
  const root = await render(<ConnectionDiscoveryCategoryHeader category="ai" providerCount={175} onBack={onBack} />)
  const back = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "All categories",
  )

  expect(document.body.textContent).toContain("AI & agents")
  expect(document.body.textContent).toContain("175 connectors")
  await act(async () => back?.click())
  expect(onBack).toHaveBeenCalledOnce()

  act(() => root.unmount())
})
