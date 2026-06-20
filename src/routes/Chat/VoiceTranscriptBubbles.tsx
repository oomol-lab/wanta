import type { VoiceTranscriptDraft } from "./composer-state.ts"

import { ChevronDown, ChevronUp, X } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface VoiceTranscriptBubblesProps {
  disabled: boolean
  transcripts: VoiceTranscriptDraft[]
  onCollapsedChange: (id: string, collapsed: boolean) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, text: string) => void
}

export function VoiceTranscriptBubbles({
  disabled,
  transcripts,
  onCollapsedChange,
  onRemove,
  onUpdate,
}: VoiceTranscriptBubblesProps) {
  const t = useT()

  if (transcripts.length === 0) {
    return null
  }

  return (
    <div className="grid w-full gap-2">
      {transcripts.map((transcript) => {
        const contentId = `voice-transcript-${transcript.id}`
        const toggleLabel = transcript.collapsed ? t("chat.voiceTranscriptExpand") : t("chat.voiceTranscriptCollapse")

        return (
          <section
            key={transcript.id}
            aria-label={t("chat.voiceTranscriptLabel")}
            className="oo-border-divider relative min-w-0 overflow-hidden rounded-lg border bg-background/75 shadow-xs"
          >
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
              <span className="oo-text-caption min-w-0 truncate text-muted-foreground">
                {t("chat.voiceTranscriptLabel")}
              </span>
              <button
                type="button"
                aria-label={t("chat.voiceTranscriptRemove")}
                title={t("chat.voiceTranscriptRemove")}
                disabled={disabled}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onRemove(transcript.id)}
              >
                <X className="size-3.5" />
              </button>
            </div>

            {transcript.collapsed ? (
              <div id={contentId} className="relative px-3 pt-2 pb-1">
                <p className="max-h-[4.75rem] overflow-hidden text-left text-sm leading-6 [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap text-foreground">
                  {transcript.text}
                </p>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-background/95" />
              </div>
            ) : (
              <div id={contentId} className="px-3 pt-2 pb-1">
                <textarea
                  value={transcript.text}
                  disabled={disabled}
                  aria-label={t("chat.voiceTranscriptLabel")}
                  rows={Math.min(8, Math.max(3, transcript.text.split(/\r\n|\r|\n/).length))}
                  className="field-sizing-content max-h-[min(32vh,16rem)] min-h-20 w-full min-w-0 resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm leading-6 [overflow-wrap:anywhere] [word-break:break-word] text-foreground shadow-none outline-none disabled:opacity-70"
                  onChange={(event) => onUpdate(transcript.id, event.target.value)}
                />
              </div>
            )}

            <div className="flex justify-center px-3 pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-controls={contentId}
                aria-expanded={!transcript.collapsed}
                className={cn("h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground")}
                onClick={() => onCollapsedChange(transcript.id, !transcript.collapsed)}
              >
                {transcript.collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                {toggleLabel}
              </Button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
