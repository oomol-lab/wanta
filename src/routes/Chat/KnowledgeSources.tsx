import type { ChatMessagePart } from "../../../electron/chat/common.ts"

import * as React from "react"
import { knowledgeSources } from "./knowledge-sources.ts"
import { useT } from "@/i18n/i18n"
import { KnowledgeNavigationContext } from "@/routes/Knowledge/navigation"

export function KnowledgeSources({ part }: { part: ChatMessagePart }) {
  const t = useT()
  const openSource = React.useContext(KnowledgeNavigationContext)
  const sources = knowledgeSources(part)
  if (sources === null) return null
  return (
    <section aria-label={t("knowledge.sources")} className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{t("knowledge.sources")}</h3>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("knowledge.emptyResults")}</p>
      ) : (
        sources.map((hit, index) => (
          <details key={`${hit.file_id}:${index}`} className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium break-words">{hit.filename}</summary>
            <p className="mt-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">{hit.text}</p>
            {openSource ? (
              <button type="button" className="mt-2 text-xs font-medium underline" onClick={() => openSource(hit)}>
                {t("knowledge.openEvidence")}
              </button>
            ) : null}
          </details>
        ))
      )}
    </section>
  )
}
