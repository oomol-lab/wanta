import type { TurnOutputFile } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { turnOutputInitialCollapsedPaths } from "./turn-output-collapse.ts"

const files: Pick<TurnOutputFile, "path">[] = [{ path: "/tmp/first.ts" }, { path: "/tmp/second.ts" }]

describe("turnOutputInitialCollapsedPaths", () => {
  it("keeps the first process file expanded by default", () => {
    expect(turnOutputInitialCollapsedPaths("process", files)).toEqual(new Set(["/tmp/second.ts"]))
  })

  it("keeps only the first project change expanded by default", () => {
    expect(turnOutputInitialCollapsedPaths("project_change", files)).toEqual(new Set(["/tmp/second.ts"]))
  })

  it("expands a selected file instead of the first file", () => {
    expect(turnOutputInitialCollapsedPaths("project_change", files, "/tmp/second.ts")).toEqual(
      new Set(["/tmp/first.ts"]),
    )
  })
})
