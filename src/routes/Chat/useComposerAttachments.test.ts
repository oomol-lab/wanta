import { describe, expect, it } from "vitest"
import { agentAttachmentMetadata } from "./useComposerAttachments.ts"

describe("agentAttachmentMetadata", () => {
  it("preserves prepared attachment metadata for saved clipboard and dropped files", () => {
    expect(
      agentAttachmentMetadata({
        agentMime: "text/plain",
        agentName: "inventory-extracted.txt",
        agentPath: "/tmp/inventory-extracted.txt",
        agentSize: 200,
        kind: "file",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        name: "inventory.xlsx",
        path: "/tmp/inventory.xlsx",
        size: 100,
      }),
    ).toEqual({
      agentMime: "text/plain",
      agentName: "inventory-extracted.txt",
      agentPath: "/tmp/inventory-extracted.txt",
      agentSize: 200,
    })
  })
})
