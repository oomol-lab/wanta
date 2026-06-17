import type { ChatAttachment, ChatContextMention } from "../../../electron/chat/common.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"

import { replaceComposerTrigger } from "./composer-triggers.ts"

export type DraftAttachment = ChatAttachment & {
  previewUrl?: string
}

export type PaletteMode = "connections" | "root" | "skills"

export interface ComposerState {
  activePaletteIndex: number
  attachments: DraftAttachment[]
  contextMentions: ChatContextMention[]
  dismissedTriggerKey: string | null
  draft: string
  draftSelection: { end: number; start: number }
  paletteMode: PaletteMode
}

export type ComposerAction =
  | { type: "add-attachments"; attachments: DraftAttachment[] }
  | { type: "add-context-mention"; mention: ChatContextMention }
  | { type: "append-transcription"; text: string }
  | { type: "remove-attachment"; id: string }
  | { type: "remove-context-mention"; mention: ChatContextMention }
  | { type: "replace-trigger"; replacement: string; trigger: ComposerTrigger }
  | { type: "reset-after-submit" }
  | { type: "set-active-palette-index"; index: number }
  | { type: "set-dismissed-trigger-key"; key: string | null }
  | { type: "set-draft"; draft: string; selection: { end: number; start: number } }
  | { type: "set-draft-selection"; selection: { end: number; start: number } }
  | { type: "set-palette-mode"; mode: PaletteMode }

export function initialComposerState(): ComposerState {
  return {
    activePaletteIndex: 0,
    attachments: [],
    contextMentions: [],
    dismissedTriggerKey: null,
    draft: "",
    draftSelection: { end: 0, start: 0 },
    paletteMode: "root",
  }
}

export function contextMentionKey(mention: ChatContextMention): string {
  return mention.kind === "skill" ? `skill:${mention.id}` : `connection:${mention.service}:${mention.appId ?? ""}`
}

function sameContextMention(left: ChatContextMention, right: ChatContextMention): boolean {
  return contextMentionKey(left) === contextMentionKey(right)
}

function appendTranscription(current: string, text: string): string {
  return current.trim() ? `${current}${/\s$/.test(current) ? "" : " "}${text}` : text
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
      return { ...state, draft: appendTranscription(state.draft, action.text) }
    case "remove-attachment":
      return { ...state, attachments: state.attachments.filter((attachment) => attachment.id !== action.id) }
    case "remove-context-mention":
      return {
        ...state,
        contextMentions: state.contextMentions.filter((mention) => !sameContextMention(mention, action.mention)),
      }
    case "replace-trigger":
      return {
        ...state,
        dismissedTriggerKey: null,
        draft: replaceComposerTrigger(state.draft, action.trigger, action.replacement),
      }
    case "reset-after-submit":
      return { ...state, attachments: [], contextMentions: [], draft: "", draftSelection: { end: 0, start: 0 } }
    case "set-active-palette-index":
      return { ...state, activePaletteIndex: action.index }
    case "set-dismissed-trigger-key":
      return { ...state, dismissedTriggerKey: action.key }
    case "set-draft":
      return { ...state, draft: action.draft, draftSelection: action.selection }
    case "set-draft-selection":
      return { ...state, draftSelection: action.selection }
    case "set-palette-mode":
      return { ...state, paletteMode: action.mode }
  }
}
