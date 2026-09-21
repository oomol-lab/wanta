import type { ActiveLinkRuntime } from "../link-runtime/common.ts"
import type { SessionScope } from "../session/common.ts"
import type { ChatContextMention } from "./common.ts"

/** A persisted selection is intent, never authority to change the host workspace. */
export function assertKnowledgeSelection(
  mentions: ChatContextMention[] | undefined,
  scope: SessionScope,
  runtime: ActiveLinkRuntime,
): void {
  for (const mention of mentions ?? []) {
    if (mention.kind !== "cloud-knowledge") continue
    if (runtime !== "oomol" || scope.kind !== "team" || !scope.teamName.trim() || mention.id !== scope.teamId) {
      throw new Error(
        "Knowledge base selection is unavailable in this workspace. Select the current OOMOL team's knowledge base again.",
      )
    }
  }
}
