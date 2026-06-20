import type { ChatAttachment, ChatContextMention } from "../../../electron/chat/common.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"

import { replaceComposerTrigger } from "./composer-triggers.ts"

export type DraftAttachment = ChatAttachment & {
  previewUrl?: string
}

export interface VoiceTranscriptDraft {
  id: string
  collapsed: boolean
  createdAt: number
  text: string
}

export interface ComposerState {
  attachments: DraftAttachment[]
  contextMentions: ChatContextMention[]
  dismissedTriggerKey: string | null
  draft: string
  draftSelection: { end: number; start: number }
  voiceTranscripts: VoiceTranscriptDraft[]
}

export type ComposerAction =
  | { type: "add-attachments"; attachments: DraftAttachment[] }
  | { type: "add-context-mention"; mention: ChatContextMention }
  | { type: "append-transcription"; transcript: VoiceTranscriptDraft }
  | { type: "remove-attachment"; id: string }
  | { type: "remove-context-mention"; mention: ChatContextMention }
  | { type: "remove-voice-transcript"; id: string }
  | { type: "replace-trigger"; replacement: string; trigger: ComposerTrigger }
  | { type: "reset-after-submit" }
  | { type: "set-dismissed-trigger-key"; key: string | null }
  | { type: "set-draft"; draft: string; selection: { end: number; start: number } }
  | { type: "set-draft-selection"; selection: { end: number; start: number } }
  | { type: "set-voice-transcript-collapsed"; collapsed: boolean; id: string }
  | { type: "update-voice-transcript"; id: string; text: string }

const VOICE_TRANSCRIPT_COLLAPSE_TEXT_LENGTH = 240
const VOICE_TRANSCRIPT_COLLAPSE_LINES = 5

export function initialComposerState(): ComposerState {
  return {
    attachments: [],
    contextMentions: [],
    dismissedTriggerKey: null,
    draft: "",
    draftSelection: { end: 0, start: 0 },
    voiceTranscripts: [],
  }
}

export function contextMentionKey(mention: ChatContextMention): string {
  return mention.kind === "skill" ? `skill:${mention.id}` : `connection:${mention.service}:${mention.appId ?? ""}`
}

function sameContextMention(left: ChatContextMention, right: ChatContextMention): boolean {
  return contextMentionKey(left) === contextMentionKey(right)
}

export function shouldCollapseVoiceTranscript(text: string): boolean {
  return (
    text.length > VOICE_TRANSCRIPT_COLLAPSE_TEXT_LENGTH ||
    text.split(/\r\n|\r|\n/).length > VOICE_TRANSCRIPT_COLLAPSE_LINES
  )
}

export function buildVoiceTranscriptDraft({
  createdAt,
  id,
  text,
}: {
  createdAt: number
  id: string
  text: string
}): VoiceTranscriptDraft {
  return {
    collapsed: shouldCollapseVoiceTranscript(text),
    createdAt,
    id,
    text,
  }
}

export function buildComposerSubmitText(draft: string, voiceTranscripts: VoiceTranscriptDraft[]): string {
  return [draft, ...voiceTranscripts.map((transcript) => transcript.text)]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n")
}

export function hasComposerDraftContent(state: ComposerState): boolean {
  return (
    state.draft.trim().length > 0 ||
    state.contextMentions.length > 0 ||
    state.voiceTranscripts.some((transcript) => transcript.text.trim().length > 0)
  )
}

export function toCachedComposerState(state: ComposerState): ComposerState {
  return {
    ...state,
    attachments: [],
    dismissedTriggerKey: null,
  }
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "add-attachments":
      if (action.attachments.length === 0) {
        return state
      }
      return { ...state, attachments: [...state.attachments, ...action.attachments] }
    case "add-context-mention":
      if (state.contextMentions.some((mention) => sameContextMention(mention, action.mention))) {
        return state
      }
      return { ...state, contextMentions: [...state.contextMentions, action.mention] }
    case "append-transcription":
      if (!action.transcript.text.trim()) {
        return state
      }
      return { ...state, voiceTranscripts: [...state.voiceTranscripts, action.transcript] }
    case "remove-attachment":
      return { ...state, attachments: state.attachments.filter((attachment) => attachment.id !== action.id) }
    case "remove-context-mention":
      return {
        ...state,
        contextMentions: state.contextMentions.filter((mention) => !sameContextMention(mention, action.mention)),
      }
    case "remove-voice-transcript":
      return {
        ...state,
        voiceTranscripts: state.voiceTranscripts.filter((transcript) => transcript.id !== action.id),
      }
    case "replace-trigger":
      return {
        ...state,
        dismissedTriggerKey: null,
        draft: replaceComposerTrigger(state.draft, action.trigger, action.replacement),
      }
    case "reset-after-submit":
      return {
        ...state,
        attachments: [],
        contextMentions: [],
        dismissedTriggerKey: null,
        draft: "",
        draftSelection: { end: 0, start: 0 },
        voiceTranscripts: [],
      }
    case "set-dismissed-trigger-key":
      return { ...state, dismissedTriggerKey: action.key }
    case "set-draft":
      return { ...state, draft: action.draft, draftSelection: action.selection }
    case "set-draft-selection":
      return { ...state, draftSelection: action.selection }
    case "set-voice-transcript-collapsed":
      return {
        ...state,
        voiceTranscripts: state.voiceTranscripts.map((transcript) =>
          transcript.id === action.id ? { ...transcript, collapsed: action.collapsed } : transcript,
        ),
      }
    case "update-voice-transcript":
      return {
        ...state,
        voiceTranscripts: state.voiceTranscripts.map((transcript) =>
          transcript.id === action.id
            ? {
                ...transcript,
                collapsed:
                  action.text === transcript.text ? transcript.collapsed : shouldCollapseVoiceTranscript(action.text),
                text: action.text,
              }
            : transcript,
        ),
      }
  }
}
