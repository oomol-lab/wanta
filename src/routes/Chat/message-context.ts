import type { ChatContextMention } from "../../../electron/chat/common.ts"

/** Keep current context chips visible; legacy mention kinds stay out of the message bubble. */
export function visibleUserContextMentions(mentions: ChatContextMention[] | undefined): ChatContextMention[] {
  return (mentions ?? []).filter(
    (mention) => mention.kind === "skill" || mention.kind === "connection" || mention.kind === "cloud-knowledge",
  )
}
