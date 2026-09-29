import { expect, it } from "vitest"
import { workbenchHref } from "./location.ts"

it("keeps flow links inside the renderer and encodes opaque flow IDs", () => {
  expect(workbenchHref({ view: "design" })).toBe("#flows")
  expect(workbenchHref({ flowId: "a/b 中文", view: "publications" })).toBe(
    "#flows/a%2Fb%20%E4%B8%AD%E6%96%87/publications",
  )
  expect(workbenchHref({ flowId: "a", view: "runs", runSource: "live" })).toBe("#flows/a/runs?source=live")
})
