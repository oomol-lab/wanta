import { describe, expect, it } from "vitest"
import { createOpencodeMessageId } from "./opencode-id.ts"

describe("createOpencodeMessageId", () => {
  it("creates OpenCode-compatible, monotonically sortable message IDs", () => {
    const first = createOpencodeMessageId(1_700_000_000_000)
    const second = createOpencodeMessageId(1_700_000_000_000)
    const later = createOpencodeMessageId(1_700_000_000_001)

    expect(first).toMatch(/^msg_[a-f0-9]{12}[0-9A-Za-z]{14}$/)
    expect(first < second).toBe(true)
    expect(second < later).toBe(true)
  })
})
