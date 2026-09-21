import type { ChatContextMention } from "../../../electron/chat/common.ts"

/** Only Skill / Connector chips are shown; dropped mention kinds stay out of the message bubble. */
export function visibleUserContextMentions(mentions: ChatContextMention[] | undefined): ChatContextMention[] {
  return (mentions ?? []).filter((mention) => mention.kind === "skill" || mention.kind === "connection")
}
