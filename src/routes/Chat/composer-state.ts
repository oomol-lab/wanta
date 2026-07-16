import type { ChatAttachment, ChatContextMention } from "../../../electron/chat/common.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"

import { BUG_REPORT_COMMAND } from "../../../electron/chat/common.ts"
import { replaceComposerTrigger } from "./composer-triggers.ts"

export type DraftAttachment = ChatAttachment & {
  previewUrl?: string
}

export interface ComposerState {
  attachments: DraftAttachment[]
  command: "bug-report" | null
  contextMentions: ChatContextMention[]
  dismissedTriggerKey: string | null
  draft: string
  draftSelection: { end: number; start: number }
}

export type ComposerAction =
  | { type: "add-attachments"; attachments: DraftAttachment[] }
  | { type: "add-context-mention"; mention: ChatContextMention }
  | { type: "insert-transcription"; text: string }
  | { type: "remove-attachment"; id: string }
  | { type: "remove-command" }
  | { type: "remove-context-mention"; mention: ChatContextMention }
  | { type: "replace-trigger"; replacement: string; trigger: ComposerTrigger }
  | { type: "reset-after-submit" }
  | { type: "select-bug-report"; trigger: ComposerTrigger }
  | { type: "set-dismissed-trigger-key"; key: string | null }
  | { type: "set-draft"; draft: string; selection: { end: number; start: number } }
  | { type: "set-draft-selection"; selection: { end: number; start: number } }

export function initialComposerState(): ComposerState {
  return {
    attachments: [],
    command: null,
    contextMentions: [],
    dismissedTriggerKey: null,
    draft: "",
    draftSelection: { end: 0, start: 0 },
  }
}

export function contextMentionKey(mention: ChatContextMention): string {
  if (mention.kind === "skill") return `skill:${mention.id}`
  if (mention.kind === "knowledge") return `knowledge:${mention.id}`
  return `connection:${mention.service}:${mention.appId ?? ""}`
}

function sameContextMention(left: ChatContextMention, right: ChatContextMention): boolean {
  return contextMentionKey(left) === contextMentionKey(right)
}

function clampSelectionIndex(index: number, draft: string): number {
  return Math.min(Math.max(index, 0), draft.length)
}

function needsAsciiWordSeparator(left: string, right: string): boolean {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)
}

export function insertVoiceTranscriptionIntoDraft(
  draft: string,
  selection: { end: number; start: number },
  text: string,
): Pick<ComposerState, "draft" | "draftSelection"> {
  const transcription = text.trim()
  if (!transcription) {
    return { draft, draftSelection: selection }
  }

  const start = clampSelectionIndex(Math.min(selection.start, selection.end), draft)
  const end = clampSelectionIndex(Math.max(selection.start, selection.end), draft)
  const before = draft.slice(0, start)
  const after = draft.slice(end)
  const prefix = needsAsciiWordSeparator(before, transcription) ? " " : ""
  const suffix = needsAsciiWordSeparator(transcription, after) ? " " : ""
  const inserted = `${prefix}${transcription}${suffix}`
  const nextSelectionIndex = before.length + inserted.length

  return {
    draft: `${before}${inserted}${after}`,
    draftSelection: { end: nextSelectionIndex, start: nextSelectionIndex },
  }
}

export function hasComposerDraftContent(state: ComposerState): boolean {
  return state.command !== null || state.draft.trim().length > 0 || state.contextMentions.length > 0
}

export function composerSubmissionText(state: Pick<ComposerState, "command" | "draft">): string {
  if (state.command !== "bug-report") {
    return state.draft
  }
  const note = state.draft.trim()
  return note ? `${BUG_REPORT_COMMAND} ${note}` : BUG_REPORT_COMMAND
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
      if (action.mention.kind === "connection") {
        const nextMention = action.mention
        return {
          ...state,
          contextMentions: [
            ...state.contextMentions.filter(
              (mention) => mention.kind !== "connection" || mention.service !== nextMention.service,
            ),
            nextMention,
          ],
        }
      }
      return { ...state, contextMentions: [...state.contextMentions, action.mention] }
    case "insert-transcription": {
      if (!action.text.trim()) {
        return state
      }
      return { ...state, ...insertVoiceTranscriptionIntoDraft(state.draft, state.draftSelection, action.text) }
    }
    case "remove-attachment":
      return { ...state, attachments: state.attachments.filter((attachment) => attachment.id !== action.id) }
    case "remove-command":
      return { ...state, command: null }
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
      return {
        ...state,
        attachments: [],
        command: null,
        contextMentions: [],
        dismissedTriggerKey: null,
        draft: "",
        draftSelection: { end: 0, start: 0 },
      }
    case "select-bug-report":
      return {
        ...state,
        command: "bug-report",
        dismissedTriggerKey: null,
        draft: replaceComposerTrigger(state.draft, action.trigger, ""),
      }
    case "set-dismissed-trigger-key":
      return { ...state, dismissedTriggerKey: action.key }
    case "set-draft":
      return { ...state, draft: action.draft, draftSelection: action.selection }
    case "set-draft-selection":
      return { ...state, draftSelection: action.selection }
  }
}
