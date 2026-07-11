import type { ResolvedArtifactGroup } from "./artifact-resolution.ts"

import { describe, expect, it } from "vitest"
import { shouldRenderGeneratedArtifactsShelf } from "./artifact-shelf-visibility.ts"

const file = {
  kind: "file" as const,
  mime: "text/plain",
  name: "report.txt",
  path: "/tmp/report.txt",
}

function group(overrides: Partial<ResolvedArtifactGroup> = {}): ResolvedArtifactGroup {
  return {
    messageId: "assistant-1",
    group: { items: [file], totalItems: 1, truncated: false },
    ...overrides,
  }
}

describe("shouldRenderGeneratedArtifactsShelf", () => {
  it("skips ready groups that have no displayable entries", () => {
    expect(
      shouldRenderGeneratedArtifactsShelf([group({ group: { items: [], totalItems: 0, truncated: false } })]),
    ).toBe(false)
  })

  it("keeps a failed group visible so its persistence warning is shown", () => {
    expect(
      shouldRenderGeneratedArtifactsShelf([
        group({ group: { items: [], totalItems: 0, truncated: false }, status: "failed" }),
      ]),
    ).toBe(true)
  })

  it("shows groups that contain a displayable artifact", () => {
    expect(shouldRenderGeneratedArtifactsShelf([group()])).toBe(true)
  })
})
