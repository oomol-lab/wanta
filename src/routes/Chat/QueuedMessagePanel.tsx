import type { QueuedChatMessage } from "@/components/app-shell/chat-queue"

import { ChevronRight, ListChecks, X } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function queuedMessagePreview(message: QueuedChatMessage): string {
  const text = message.text.trim()
  if (text) {
    return text
  }
  return message.attachments.map((attachment) => attachment.name).join(", ")
}

export function QueuedMessagePanel({
  messages,
  onRemove,
}: {
  messages: QueuedChatMessage[]
  onRemove: (id: string) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(true)
  if (messages.length === 0) {
    return null
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="oo-border-divider overflow-hidden rounded-xl border bg-background/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className={cn("flex h-9 items-center px-2", open && "border-b border-border/50")}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={open ? t("chat.queueCollapse") : t("chat.queueExpand")}
          >
            <ListChecks className="size-4 shrink-0 text-muted-foreground" />
            <span className="oo-text-control min-w-0 flex-1 truncate text-muted-foreground">
              {t("chat.queueTitle", { count: messages.length })}
            </span>
            <ChevronRight
              className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="max-h-40 overflow-auto">
          {messages.map((message) => {
            const preview = queuedMessagePreview(message)
            return (
              <div key={message.id} className="flex h-10 items-center gap-2 px-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="oo-text-control min-w-0 truncate text-foreground/90">
                      {preview || t("chat.queueAttachmentOnly")}
                    </span>
                  </div>
                  {message.attachments.length > 0 ? (
                    <div className="oo-text-caption mt-0.5 truncate text-muted-foreground">
                      {t("chat.queueAttachments", { count: message.attachments.length })}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  title={t("chat.queueRemove")}
                  aria-label={t("chat.queueRemove")}
                  onClick={() => onRemove(message.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
