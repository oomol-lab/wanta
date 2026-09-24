import type { ChatMessage } from "../../../electron/chat/common.ts"
import type { KnowledgeHit } from "../../../electron/knowledge/common.ts"

import { knowledgeSources } from "./knowledge-sources.ts"

/** Only persisted, completed retrieval tool results may become source links. */
export function knowledgeAnswerHits(messages: ChatMessage[]): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      for (const hit of knowledgeSources(part) ?? []) {
        const key = `${hit.file_id}\u0000${hit.text}`
        if (seen.has(key)) continue
        seen.add(key)
        hits.push(hit)
      }
    }
  }
  return hits
}
