import { CheckIcon, CopyIcon } from "lucide-react"
import * as React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useClipboardCopy } from "@/hooks/useClipboardCopy"
import { cn } from "@/lib/utils"

export function CopyIconButton({
  ariaLabel,
  className,
  copiedLabel,
  failureMessage,
  iconClassName,
  tooltipClassName,
  tooltipLabel,
  value,
}: {
  ariaLabel: string
  className?: string
  copiedLabel: string
  failureMessage: string
  iconClassName?: string
  tooltipClassName?: string
  tooltipLabel?: string
  value: string
}) {
  const { copied, copyText } = useClipboardCopy({ failureMessage })
  const Icon = copied ? CheckIcon : CopyIcon

  const copyValue = React.useCallback(async () => {
    await copyText(value)
  }, [copyText, value])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            className,
          )}
          data-copied={copied ? "true" : "false"}
          aria-label={copied ? copiedLabel : ariaLabel}
          onClick={() => void copyValue()}
        >
          <Icon className={cn("size-3.5", iconClassName)} />
        </button>
      </TooltipTrigger>
      <TooltipContent className={tooltipClassName}>{copied ? copiedLabel : (tooltipLabel ?? value)}</TooltipContent>
    </Tooltip>
  )
}
