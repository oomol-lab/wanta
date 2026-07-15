import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"

import { Check, ChevronDown, LibraryBig } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function knowledgeContextSummary(items: KnowledgeBaseSummary[], countLabel: (count: number) => string): string {
  if (items.length === 1) {
    return items[0]?.title ?? ""
  }
  return countLabel(items.length)
}

export function KnowledgeContextBar({
  activeItems,
  items,
  queuedMessageCount,
  onToggle,
}: {
  activeItems: KnowledgeBaseSummary[]
  items: KnowledgeBaseSummary[]
  queuedMessageCount: number
  onToggle: (id: string) => void
}) {
  const t = useT()
  const activeIds = new Set(activeItems.map((item) => item.id))
  const summary = knowledgeContextSummary(activeItems, (count) => t("knowledge.contextCount", { count }))

  return (
    <div className="oo-border-divider mx-1 flex min-h-10 min-w-0 items-center gap-2 rounded-xl border bg-muted/35 px-2.5 py-1.5 shadow-xs">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-xs">
        <LibraryBig className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="oo-text-caption shrink-0 font-medium text-muted-foreground">
          {t("knowledge.currentContext")}
        </span>
        <span className="oo-text-control min-w-0 truncate font-medium text-foreground" title={summary}>
          {summary}
        </span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 rounded-lg px-2 text-muted-foreground hover:text-foreground"
          >
            {t("knowledge.manageContext")}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] p-0">
          <div className="border-b px-3.5 py-3">
            <div className="oo-text-control font-semibold text-foreground">{t("knowledge.contextTitle")}</div>
            <p className="oo-text-caption mt-0.5 text-muted-foreground">{t("knowledge.contextDescription")}</p>
            {queuedMessageCount > 0 ? (
              <p className="oo-text-caption mt-2 rounded-lg bg-muted px-2.5 py-2 text-muted-foreground">
                {t("knowledge.contextQueueNotice", { count: queuedMessageCount })}
              </p>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {items.map((item) => {
              const selected = activeIds.has(item.id)
              const metadata = [item.authors.join("、"), item.publisher].filter(Boolean).join(" · ")
              return (
                <button
                  key={item.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => onToggle(item.id)}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                    {item.coverDataUrl ? (
                      <img src={item.coverDataUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <LibraryBig className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="oo-text-control block truncate font-medium text-foreground">{item.title}</span>
                    {metadata ? (
                      <span className="oo-text-caption block truncate text-muted-foreground">{metadata}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-md border",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-transparent",
                    )}
                    aria-hidden="true"
                  >
                    <Check className="size-3.5" />
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
