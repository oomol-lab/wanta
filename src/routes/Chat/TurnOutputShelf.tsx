import type { TurnOutputRecord } from "../../../electron/chat/common.ts"
import type { TurnOutputSelection } from "./TurnOutputs.tsx"

import { ChevronRight } from "lucide-react"
import { useT } from "@/i18n/i18n"

export function TurnOutputShelf({
  record,
  onOpen,
}: {
  record: TurnOutputRecord
  onOpen: (selection: TurnOutputSelection) => void
}) {
  const t = useT()
  const hasProjectChanges = record.summary.changedFileCount > 0
  const hasProcessFiles = record.summary.processFileCount > 0

  if (!hasProjectChanges && !hasProcessFiles) {
    return null
  }

  return (
    <div className="not-prose mt-1 flex min-w-0 flex-wrap items-center gap-3">
      {hasProjectChanges ? (
        <button
          type="button"
          className="oo-text-caption flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
          onClick={() => onOpen({ record, initialRole: "project_change" })}
        >
          <span>{t("turnOutputs.viewChanges", { count: record.summary.changedFileCount })}</span>
          <ChevronRight className="size-4 shrink-0" />
        </button>
      ) : null}
      {hasProcessFiles ? (
        <button
          type="button"
          className="oo-text-caption flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
          onClick={() => onOpen({ record, initialRole: "process" })}
        >
          <span>{t("turnOutputs.viewProcess", { count: record.summary.processFileCount })}</span>
          <ChevronRight className="size-4 shrink-0" />
        </button>
      ) : null}
    </div>
  )
}
