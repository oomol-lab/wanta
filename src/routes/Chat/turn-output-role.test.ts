import { describe, expect, it } from "vitest"
import { availableTurnOutputRole } from "./turn-output-role.ts"

describe("availableTurnOutputRole", () => {
  it("keeps the requested role when both file groups exist", () => {
    expect(availableTurnOutputRole("project_change", 2, 3)).toBe("project_change")
    expect(availableTurnOutputRole("process", 2, 3)).toBe("process")
  })

  it("falls back to process files when there are no project changes", () => {
    expect(availableTurnOutputRole("project_change", 2, 0)).toBe("process")
  })

  it("falls back to project changes when there are no process files", () => {
    expect(availableTurnOutputRole("process", 0, 3)).toBe("project_change")
  })

  it("keeps the project review available for an incomplete change scan", () => {
    expect(availableTurnOutputRole("project_change", 0, 0, true)).toBe("project_change")
    expect(availableTurnOutputRole("process", 0, 0, true)).toBe("project_change")
  })
})
