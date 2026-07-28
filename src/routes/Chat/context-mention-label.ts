import type { ChatContextMention } from "../../../electron/chat/common.ts"

export function skillContextMentionLabel(mention: Extract<ChatContextMention, { kind: "skill" }>): string {
  return mention.displayName ?? mention.name
}
