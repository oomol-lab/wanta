import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { PageRouteShell } from "./PageRouteShell.tsx"

it("renders supplied titlebar actions inside the page header", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      PageRouteShell,
      {
        backLabel: "Back",
        onBack: () => undefined,
        titlebarActions: React.createElement("button", { "data-titlebar-action": "update" }, "Restart"),
      },
      React.createElement("div", null, "Content"),
    ),
  )

  const headerEnd = html.indexOf("</header>")
  const action = html.indexOf('data-titlebar-action="update"')
  expect(action).toBeGreaterThanOrEqual(0)
  expect(action).toBeLessThan(headerEnd)
})
