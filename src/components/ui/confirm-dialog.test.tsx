// @vitest-environment happy-dom

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { ConfirmDialog, ConfirmDialogContent, ConfirmDialogDescription, ConfirmDialogTitle } from "./confirm-dialog.tsx"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

describe("ConfirmDialogContent", () => {
  it("clips edge-to-edge descendants to its rounded surface", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <ConfirmDialog open>
          <ConfirmDialogContent>
            <ConfirmDialogTitle>Confirm action</ConfirmDialogTitle>
            <ConfirmDialogDescription>Review this action.</ConfirmDialogDescription>
          </ConfirmDialogContent>
        </ConfirmDialog>,
      )
    })

    const content = document.querySelector<HTMLElement>('[data-slot="confirm-dialog-content"]')
    expect(content?.classList.contains("overflow-hidden")).toBe(true)

    act(() => root.unmount())
  })
})
