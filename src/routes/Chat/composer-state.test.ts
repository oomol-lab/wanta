import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  buildComposerSubmitText,
  buildVoiceTranscriptDraft,
  composerReducer,
  contextMentionKey,
  hasComposerDraftContent,
  initialComposerState,
  shouldCollapseVoiceTranscript,
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

  it("stores transcription as a separate voice transcript", () => {
    const transcript = buildVoiceTranscriptDraft({
      createdAt: 1,
      id: "voice-1",
      text: "Summarize this",
    })
    const state = composerReducer(
      composerReducer(initialComposerState(), {
        draft: "Please",
        selection: { end: 6, start: 6 },
        type: "set-draft",
      }),
      { transcript, type: "append-transcription" },
    )

    expect(state.draft).toBe("Please")
    expect(state.voiceTranscripts).toEqual([transcript])
  })

  it("collapses long voice transcripts by default", () => {
    expect(shouldCollapseVoiceTranscript("short transcript")).toBe(false)
    expect(shouldCollapseVoiceTranscript(["one", "two", "three", "four", "five", "six"].join("\n"))).toBe(true)
    expect(shouldCollapseVoiceTranscript("x".repeat(241))).toBe(true)
  })

  it("combines draft and voice transcripts for submit text", () => {
    expect(
      buildComposerSubmitText(" Please summarize ", [
        buildVoiceTranscriptDraft({ createdAt: 1, id: "voice-1", text: " first part " }),
        buildVoiceTranscriptDraft({ createdAt: 2, id: "voice-2", text: "second part" }),
      ]),
    ).toBe("Please summarize\n\nfirst part\n\nsecond part")
  })

  it("updates, collapses, and removes voice transcripts by id", () => {
    const initial = composerReducer(initialComposerState(), {
      transcript: buildVoiceTranscriptDraft({ createdAt: 1, id: "voice-1", text: "hello" }),
      type: "append-transcription",
    })
    const collapsed = composerReducer(initial, {
      collapsed: true,
      id: "voice-1",
      type: "set-voice-transcript-collapsed",
    })
    const updated = composerReducer(collapsed, {
      id: "voice-1",
      text: "updated",
      type: "update-voice-transcript",
    })
    const removed = composerReducer(updated, { id: "voice-1", type: "remove-voice-transcript" })

    expect(collapsed.voiceTranscripts[0]?.collapsed).toBe(true)
    expect(updated.voiceTranscripts[0]).toMatchObject({ collapsed: false, text: "updated" })
    expect(removed.voiceTranscripts).toEqual([])
  })

  it("clears palette suppression when resetting after submit", () => {
    const state = {
      ...initialComposerState(),
      dismissedTriggerKey: "slash:0:rev",
      draft: "/rev",
      voiceTranscripts: [buildVoiceTranscriptDraft({ createdAt: 1, id: "voice-1", text: "hello" })],
    }

    expect(composerReducer(state, { type: "reset-after-submit" })).toMatchObject({
      dismissedTriggerKey: null,
      draft: "",
      voiceTranscripts: [],
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
    const withTranscript = {
      ...empty,
      voiceTranscripts: [buildVoiceTranscriptDraft({ createdAt: 1, id: "voice-1", text: "hello" })],
    }

    expect(hasComposerDraftContent(empty)).toBe(false)
    expect(hasComposerDraftContent(withTranscript)).toBe(true)
    expect(toCachedComposerState(withAttachment).attachments).toEqual([])
  })
})
