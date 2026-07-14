import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { visibleUserContextMentions } from "./message-context.ts"

describe("visible user context mentions", () => {
  it("hides conversation-level knowledge while preserving turn-level context", () => {
    const mentions: ChatContextMention[] = [
      { id: "knowledge-1", kind: "knowledge", name: "Journey to the West" },
      { id: "skill-1", kind: "skill", name: "Research" },
      { displayName: "Gmail", kind: "connection", service: "gmail" },
    ]

    expect(visibleUserContextMentions(mentions)).toEqual(mentions.slice(1))
  })

  it("returns an empty list without context", () => {
    expect(visibleUserContextMentions(undefined)).toEqual([])
  })
})
