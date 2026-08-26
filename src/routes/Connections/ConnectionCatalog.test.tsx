// @vitest-environment happy-dom

import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { ConnectionListToolbar } from "./ConnectionCatalog.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

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

test("discover Type filters keep General first and Connected second", async () => {
  const onFilterChange = vi.fn()
  const root = await render(
    <ConnectionListToolbar
      activeFilter={{ kind: "all" }}
      authFilter="all"
      attentionCount={2}
      availableToolsCount={25}
      connectedCount={7}
      directlyAvailableCount={18}
      loading={false}
      managedConnectionCount={9}
      query=""
      resultCount={100}
      searchPlaceholder="Search providers"
      showConnectionState
      sortMode="recommended"
      totalCount={100}
      view="discover"
      onAuthFilterChange={() => undefined}
      onFilterChange={onFilterChange}
      onQueryChange={() => undefined}
      onReset={() => undefined}
      onSortModeChange={() => undefined}
    />,
  )
  const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]'))
  const typeLabels = typeButtons.map((button) => button.querySelector("span")?.textContent)

  expect(typeLabels).toEqual(["General", "Connected", "Available tools", "No setup"])
  await act(async () => typeButtons[1]?.click())
  expect(onFilterChange).toHaveBeenCalledWith({ kind: "connected" })

  act(() => root.unmount())
})
