import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { composerReducer, contextMentionKey, initialComposerState } from "./composer-state.ts"

const skillMention: ChatContextMention = {
  id: "skill-a",
  kind: "skill",
  name: "Skill A",
}

const connectionMention: ChatContextMention = {
  appId: "app-a",
  displayName: "Gmail",
  kind: "connection",
  service: "gmail",
}

describe("composer state", () => {
  it("deduplicates context mentions by stable key", () => {
    const once = composerReducer(initialComposerState(), { type: "add-context-mention", mention: skillMention })
    const twice = composerReducer(once, { type: "add-context-mention", mention: { ...skillMention, name: "Renamed" } })

    expect(twice.contextMentions).toEqual([skillMention])
    expect(contextMentionKey(connectionMention)).toBe("connection:gmail:app-a")
  })

  it("replaces a trigger and clears dismissed trigger state", () => {
    const initial = composerReducer(initialComposerState(), {
      draft: "/rev please",
      selection: { end: 4, start: 4 },
      type: "set-draft",
    })
    const dismissed = composerReducer(initial, { key: "slash:0:rev", type: "set-dismissed-trigger-key" })

    expect(
      composerReducer(dismissed, {
        replacement: "Review this ",
        trigger: { end: 4, kind: "slash", query: "rev", start: 0 },
        type: "replace-trigger",
      }),
    ).toMatchObject({
      dismissedTriggerKey: null,
      draft: "Review this  please",
    })
  })

  it("appends transcription with a separating space only when needed", () => {
    const withDraft = composerReducer(
      composerReducer(initialComposerState(), {
        draft: "Summarize",
        selection: { end: 9, start: 9 },
        type: "set-draft",
      }),
      { text: "this", type: "append-transcription" },
    )
    const withTrailingSpace = composerReducer(
      composerReducer(initialComposerState(), {
        draft: "Summarize ",
        selection: { end: 10, start: 10 },
        type: "set-draft",
      }),
      { text: "this", type: "append-transcription" },
    )

    expect(withDraft.draft).toBe("Summarize this")
    expect(withTrailingSpace.draft).toBe("Summarize this")
  })
})
