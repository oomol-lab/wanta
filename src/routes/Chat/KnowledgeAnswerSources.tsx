import type { ChatMessage } from "../../../electron/chat/common.ts"
import type { KnowledgeHit } from "../../../electron/knowledge/common.ts"

import * as React from "react"
import { knowledgeAnswerHits } from "./knowledge-answer-sources.ts"
import { useT } from "@/i18n/i18n"
import { KnowledgeNavigationContext } from "@/routes/Knowledge/navigation"

export function KnowledgeAnswerSources({ messages }: { messages: ChatMessage[] }) {
  const t = useT()
  const openSource = React.useContext(KnowledgeNavigationContext)
  const hits = React.useMemo(() => knowledgeAnswerHits(messages), [messages])
  if (hits.length === 0) return null
  const byFile = new Map<string, KnowledgeHit>()
  for (const hit of hits) if (!byFile.has(hit.file_id)) byFile.set(hit.file_id, hit)
  return (
    <section aria-label={t("knowledge.sources")} className="mt-3 rounded-lg border bg-muted/20 p-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        {t("knowledge.sources")} · {byFile.size}
      </h3>
      <div className="flex flex-col gap-1">
        {[...byFile.values()].map((hit) => (
          <button
            key={hit.file_id}
            type="button"
            disabled={!openSource}
            className="min-w-0 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
            onClick={() => openSource?.(hit)}
          >
            <span className="block truncate text-xs font-medium">{hit.filename}</span>
            <span className="mt-0.5 line-clamp-2 block text-xs break-words text-muted-foreground">{hit.text}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
