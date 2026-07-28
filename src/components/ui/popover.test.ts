// @vitest-environment happy-dom

import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx"

async function renderPopover(): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement("div")
  host.style.overflow = "hidden"
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(
        Popover,
        null,
        React.createElement(PopoverTrigger, null, "Open usage"),
        React.createElement(PopoverContent, null, "Usage details"),
      ),
    )
  })
  return { host, root }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("PopoverContent", () => {
  it("portals open content outside an overflow-hidden trigger ancestor", async () => {
    const { host, root } = await renderPopover()
    const trigger = host.querySelector<HTMLButtonElement>('[data-slot="popover-trigger"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.click()
    })

    const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    expect(content).not.toBeNull()
    expect(content?.textContent).toBe("Usage details")
    expect(host.contains(content)).toBe(false)
    expect(content?.parentElement?.parentElement).toBe(document.body)

    act(() => root.unmount())
  })
})
