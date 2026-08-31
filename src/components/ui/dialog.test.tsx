// @vitest-environment happy-dom

import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Dialog } from "./dialog.tsx"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderDialog(
  props: Partial<React.ComponentProps<typeof Dialog>> = {},
): Promise<{ host: HTMLElement; root: Root }> {
  const { children = <button type="button">Dialog action</button>, ...dialogProps } = props
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      <Dialog open onClose={() => undefined} title="Dialog title" description="Dialog description" {...dialogProps}>
        {children}
      </Dialog>,
    )
  })

  return { host, root }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("Dialog", () => {
  it("uses a Radix portal while preserving Wanta's modal slots and visual tokens", async () => {
    const { host, root } = await renderDialog()
    const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')

    expect(content?.getAttribute("role")).toBe("dialog")
    expect(content?.getAttribute("aria-modal")).toBe("true")
    expect(content?.textContent).toContain("Dialog title")
    expect(content?.classList.contains("oo-modal-surface")).toBe(true)
    expect(content?.classList.contains("overflow-hidden")).toBe(true)
    expect(overlay?.classList.contains("oo-modal-backdrop")).toBe(true)
    expect(host.contains(content)).toBe(false)

    act(() => root.unmount())
  })

  it("routes the primitive close action through the compatibility onClose callback", async () => {
    const onClose = vi.fn()
    const { root } = await renderDialog({ closeLabel: "Dismiss", onClose })
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')

    await act(async () => close?.click())

    expect(onClose).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it("honors the existing initialFocus callback", async () => {
    const inputRef = React.createRef<HTMLInputElement>()
    const { root } = await renderDialog({
      children: <input ref={inputRef} aria-label="Preferred input" />,
      initialFocus: () => inputRef.current,
    })

    expect(document.activeElement).toBe(inputRef.current)
    act(() => root.unmount())
  })
})
