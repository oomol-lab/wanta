import { act, useState } from "react"
import { createRoot } from "react-dom/client"
// @vitest-environment happy-dom
import { expect, test } from "vitest"
import { Checkbox } from "./checkbox"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test("checkbox distinguishes mixed and checked backgrounds without selection icons", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Menu() {
    const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate")
    return <Checkbox aria-label="Select all" checked={checked} onCheckedChange={setChecked} />
  }
  try {
    await act(async () => root.render(<Menu />))
    const checkbox = host.querySelector<HTMLElement>('[role="checkbox"]')!
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed")
    expect(checkbox.getAttribute("data-state")).toBe("indeterminate")
    expect(checkbox.className).toContain("data-[state=indeterminate]:bg-muted-foreground")
    expect(checkbox.querySelector("svg")).toBeNull()
    await act(async () => checkbox.click())
    expect(checkbox.getAttribute("aria-checked")).toBe("true")
    expect(checkbox.getAttribute("data-state")).toBe("checked")
    expect(checkbox.className).toContain("data-[state=checked]:bg-primary")
    await act(async () => checkbox.click())
    expect(checkbox.getAttribute("aria-checked")).toBe("false")
  } finally {
    await act(async () => root.unmount())
    await new Promise((resolve) => setTimeout(resolve, 0))
    host.remove()
  }
})
