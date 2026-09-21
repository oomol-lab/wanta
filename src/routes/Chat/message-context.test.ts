import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { visibleUserContextMentions } from "./message-context.ts"

describe("visible user context mentions", () => {
  it("keeps skill and connection mentions", () => {
    const mentions: ChatContextMention[] = [
      { id: "skill-1", kind: "skill", name: "Research" },
      { displayName: "Gmail", kind: "connection", service: "gmail" },
    ]

    expect(visibleUserContextMentions(mentions)).toEqual(mentions)
  })

  it("returns an empty list without context", () => {
    expect(visibleUserContextMentions(undefined)).toEqual([])
  })
})
