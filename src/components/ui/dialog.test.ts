// @vitest-environment happy-dom

import { describe, expect, it } from "vitest"
import { isPortalKeyboardOwner } from "./dialog.tsx"

describe("isPortalKeyboardOwner", () => {
  it("leaves nested confirmation keyboard handling to the topmost portal", () => {
    const content = document.createElement("div")
    content.dataset.slot = "confirm-dialog-content"
    const button = document.createElement("button")
    content.append(button)

    expect(isPortalKeyboardOwner(button)).toBe(true)
  })

  it("does not relinquish keyboard ownership to ordinary dialog content", () => {
    expect(isPortalKeyboardOwner(document.createElement("button"))).toBe(false)
  })
})
