import type { ChatContextMention } from "../../../electron/chat/common.ts"

/** 对话级知识库由固定栏展示；消息气泡只展示当前轮显式选择的 Skill / Connector。 */
export function visibleUserContextMentions(mentions: ChatContextMention[] | undefined): ChatContextMention[] {
  return (mentions ?? []).filter((mention) => mention.kind !== "knowledge")
}
