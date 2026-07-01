import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  composerReducer,
  contextMentionKey,
  hasComposerDraftContent,
  initialComposerState,
  insertVoiceTranscriptionIntoDraft,
  toCachedComposerState,
} from "./composer-state.ts"

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

  it("replaces previous connection context when switching accounts for the same service", () => {
    const first = composerReducer(initialComposerState(), { type: "add-context-mention", mention: connectionMention })
    const switched = composerReducer(first, {
      type: "add-context-mention",
      mention: {
        appId: "app-b",
        displayName: "Gmail",
        kind: "connection",
        service: "gmail",
      },
    })

    expect(switched.contextMentions).toEqual([
      {
        appId: "app-b",
        displayName: "Gmail",
        kind: "connection",
        service: "gmail",
      },
    ])
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

  it("inserts voice transcription into the draft at the current cursor", () => {
    const state = composerReducer(
      composerReducer(initialComposerState(), {
        draft: "Please",
        selection: { end: 6, start: 6 },
        type: "set-draft",
      }),
      { text: "summarize this", type: "insert-transcription" },
    )

    expect(state.draft).toBe("Please summarize this")
    expect(state.draftSelection).toEqual({ end: 21, start: 21 })
  })

  it("replaces the selected draft text with voice transcription", () => {
    expect(insertVoiceTranscriptionIntoDraft("Please summarize this file", { end: 16, start: 7 }, "translate")).toEqual(
      {
        draft: "Please translate this file",
        draftSelection: { end: 16, start: 16 },
      },
    )
  })

  it("keeps Chinese transcription adjacent to Chinese draft text", () => {
    expect(insertVoiceTranscriptionIntoDraft("帮我", { end: 2, start: 2 }, "总结一下")).toEqual({
      draft: "帮我总结一下",
      draftSelection: { end: 6, start: 6 },
    })
  })

  it("ignores empty voice transcription", () => {
    const state = {
      ...initialComposerState(),
      draft: "Please",
      draftSelection: { end: 6, start: 6 },
    }

    expect(composerReducer(state, { text: "   ", type: "insert-transcription" })).toBe(state)
  })

  it("clears palette suppression when resetting after submit", () => {
    const state = {
      ...initialComposerState(),
      dismissedTriggerKey: "slash:0:rev",
      draft: "/rev",
    }

    expect(composerReducer(state, { type: "reset-after-submit" })).toMatchObject({
      dismissedTriggerKey: null,
      draft: "",
    })
  })

  it("detects cacheable draft content without preserving attachment previews", () => {
    const empty = initialComposerState()
    const withAttachment = {
      ...empty,
      attachments: [
        {
          id: "file-1",
          kind: "file" as const,
          mime: "text/plain",
          name: "note.txt",
          path: "/tmp/note.txt",
          previewUrl: "blob:preview",
          size: 10,
        },
      ],
    }
    const withDraft = {
      ...empty,
      draft: "hello",
      draftSelection: { end: 5, start: 5 },
    }

    expect(hasComposerDraftContent(empty)).toBe(false)
    expect(hasComposerDraftContent(withDraft)).toBe(true)
    expect(toCachedComposerState(withAttachment).attachments).toEqual([])
  })
})
