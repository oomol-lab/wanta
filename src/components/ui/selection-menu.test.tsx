import { act, useState } from "react"
import { createRoot } from "react-dom/client"
// @vitest-environment happy-dom
import { expect, test } from "vitest"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./dropdown-menu"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test("selection changes state and uses background highlighting without a dot", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Menu() {
    const [value, setValue] = useState("all")
    return (
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="api">API Key</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  try {
    await act(async () => root.render(<Menu />))
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(items[0].getAttribute("aria-checked")).toBe("true")
    expect(items[0].getAttribute("data-state")).toBe("checked")
    expect(items[0].className).toContain("data-[state=checked]:bg-secondary")
    expect(items[0].querySelector("svg")).toBeNull()
    await act(async () => items[1].click())
    expect(items[0].getAttribute("aria-checked")).toBe("false")
    expect(items[1].getAttribute("aria-checked")).toBe("true")
    expect(items[1].getAttribute("data-state")).toBe("checked")
    expect(items[1].querySelector("svg")).toBeNull()
  } finally {
    await act(async () => root.unmount())
    await new Promise((resolve) => setTimeout(resolve, 0))
    host.remove()
  }
})
