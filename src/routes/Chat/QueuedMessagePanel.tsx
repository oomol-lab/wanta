import type { QueuedChatMessage, QueuedMessageMovePlacement } from "@/components/app-shell/chat-queue"

import { GripVertical, Trash2 } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
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
  queueHeld,
  onMove,
  onRemove,
  onResume,
}: {
  messages: QueuedChatMessage[]
  queueHeld: boolean
  onMove: (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => void
  onRemove: (id: string) => void
  onResume: () => void
}) {
  const t = useT()
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{
    id: string
    placement: QueuedMessageMovePlacement
  } | null>(null)

  if (messages.length === 0) {
    return null
  }

  return (
    <div
      className="oo-queue-dock mx-5 -mb-2 overflow-hidden rounded-t-[1.125rem] rounded-b-xl border text-[0.8125rem] leading-5 backdrop-blur supports-[backdrop-filter]:backdrop-blur"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTarget(null)
        }
      }}
    >
      {queueHeld ? (
        <div className="oo-queue-dock-paused flex min-h-11 items-center gap-3 border-b border-border/45 px-4 py-2">
          <div className="oo-text-control min-w-0 flex-1 truncate font-medium text-foreground">
            {t("chat.queuePaused")}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 rounded-full px-3 text-muted-foreground hover:text-foreground"
            onClick={onResume}
          >
            {t("chat.queueResume")}
          </Button>
        </div>
      ) : null}
      <div className="max-h-[min(45vh,18rem)] overflow-y-auto">
        {messages.map((message) => (
          <QueuedMessageRow
            key={message.id}
            dragging={draggingId === message.id}
            dropPlacement={dropTarget?.id === message.id ? dropTarget.placement : null}
            message={message}
            onDragEnd={() => {
              setDraggingId(null)
              setDropTarget(null)
            }}
            onDragOver={(event) => {
              if (!draggingId || draggingId === message.id) {
                return
              }
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
              const rect = event.currentTarget.getBoundingClientRect()
              const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after"
              setDropTarget({ id: message.id, placement })
            }}
            onDragStart={(event) => {
              setDraggingId(message.id)
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", message.id)
            }}
            onDrop={(event) => {
              event.preventDefault()
              const sourceId = draggingId ?? event.dataTransfer.getData("text/plain")
              const target =
                dropTarget?.id === message.id
                  ? dropTarget
                  : ({ id: message.id, placement: "before" } satisfies {
                      id: string
                      placement: QueuedMessageMovePlacement
                    })
              setDraggingId(null)
              setDropTarget(null)
              if (sourceId && sourceId !== target.id) {
                onMove(sourceId, target.id, target.placement)
              }
            }}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  )
}

function QueuedMessageRow({
  dragging,
  dropPlacement,
  message,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onRemove,
}: {
  dragging: boolean
  dropPlacement: QueuedMessageMovePlacement | null
  message: QueuedChatMessage
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onRemove: (id: string) => void
}) {
  const t = useT()
  const preview = queuedMessagePreview(message)
  return (
    <div
      className={cn(
        "oo-queue-dock-row relative flex min-h-9 min-w-0 items-center gap-2 px-3 py-1.5 transition-colors",
        dragging && "opacity-45",
        dropPlacement === "before" &&
          "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-foreground/45 before:content-['']",
        dropPlacement === "after" &&
          "after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-foreground/45 after:content-['']",
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        draggable
        className="-ml-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        title={t("chat.queueReorder")}
        aria-label={t("chat.queueReorder")}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="oo-text-control min-w-0 truncate text-foreground/90">
          {preview || t("chat.queueAttachmentOnly")}
        </div>
        {message.attachments.length > 0 ? (
          <div className="oo-text-caption-compact mt-0.5 truncate text-muted-foreground">
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
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
