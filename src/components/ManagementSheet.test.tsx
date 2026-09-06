// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { ManagementSheet } from "./ManagementSheet.tsx"
import { Dialog } from "./ui/dialog.tsx"
vi.mock("@/i18n", () => ({ useAppI18n: () => ({ t: (key: string) => key }) }))

test("nested dialogs close independently and the sheet restores its opening control", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Probe() {
    const [open, setOpen] = React.useState(false)
    const [nested, setNested] = React.useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open sheet</button>
        <ManagementSheet title="Members" open={open} onClose={() => setOpen(false)}>
          <button onClick={() => setNested(true)}>Open nested</button>
          <input aria-label="Enabled input" />
          <input disabled aria-label="Disabled input" />
          <Dialog title="Nested" open={nested} onClose={() => setNested(false)}>
            <button>Nested action</button>
          </Dialog>
        </ManagementSheet>
      </>
    )
  }
  try {
    await act(async () => root.render(<Probe />))
    const opener = host.querySelector<HTMLButtonElement>("button")!
    opener.focus()
    await act(async () => opener.click())
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(sheet.contains(document.activeElement)).toBe(true)
    const nestedOpener = [...sheet.querySelectorAll("button")].find((button) => button.textContent === "Open nested")!
    nestedOpener.focus()
    await act(async () => nestedOpener.click())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    )
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.activeElement).toBe(nestedOpener)
    await act(async () => sheet.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')!.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(document.activeElement).toBe(opener)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

test("a disappearing row opener falls back to the persistent page container", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Probe() {
    const pageRef = React.useRef<HTMLElement>(null)
    const [open, setOpen] = React.useState(false)
    const [showRow, setShowRow] = React.useState(true)
    return (
      <>
        <section ref={pageRef} tabIndex={-1} aria-label="Page">
          {showRow ? <button onClick={() => setOpen(true)}>Open row</button> : null}
        </section>
        <ManagementSheet
          title="Row"
          open={open}
          fallbackFocus={() => pageRef.current}
          onClose={() => {
            setShowRow(false)
            setOpen(false)
          }}
        >
          <p>Row detail</p>
        </ManagementSheet>
      </>
    )
  }
  try {
    await act(async () => root.render(<Probe />))
    const opener = host.querySelector<HTMLButtonElement>("button")!
    opener.focus()
    await act(async () => opener.click())
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')!.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(opener.isConnected).toBe(false)
    expect(document.activeElement).toBe(host.querySelector("section"))
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
