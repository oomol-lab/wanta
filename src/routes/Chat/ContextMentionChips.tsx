import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { Package, Plug, X } from "lucide-react"
import { contextMentionKey } from "./composer-state.ts"
import { useT } from "@/i18n/i18n"

function contextMentionLabel(mention: ChatContextMention): string {
  return mention.kind === "skill" ? mention.name : mention.displayName
}

export function ContextMentionChips({
  mentions,
  onRemove,
}: {
  mentions: ChatContextMention[]
  onRemove?: (mention: ChatContextMention) => void
}) {
  const t = useT()
  if (mentions.length === 0) {
    return null
  }
  return (
    <div className="flex w-full flex-wrap gap-2">
      {mentions.map((mention) => (
        <span
          key={contextMentionKey(mention)}
          className="oo-border-divider flex h-8 max-w-full items-center gap-2 rounded-lg border bg-background/70 px-2 text-sm shadow-xs"
          title={mention.kind === "skill" ? mention.description : mention.accountLabel}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {mention.kind === "skill" ? <Package className="size-3.5" /> : <Plug className="size-3.5" />}
          </span>
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">
              {mention.kind === "skill" ? t("chat.contextSkillPrefix") : t("chat.contextConnectionPrefix")}
            </span>
            <span className="ml-1 font-medium text-foreground">{contextMentionLabel(mention)}</span>
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={t("chat.contextRemove", { name: contextMentionLabel(mention) })}
              className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onRemove(mention)}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}
