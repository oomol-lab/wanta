import type { ComponentProps } from "react"

import { Check, Copy, Download, Maximize2, X } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { tableElementToRows, tableRowsToMarkdown } from "./markdown-table-data.ts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MarkdownTableProps = ComponentProps<"table"> & {
  node?: unknown
}

type CopyState = "idle" | "copied" | "error"

export function MarkdownTable({ children, className, node: _, ...props }: MarkdownTableProps) {
  const tableRef = React.useRef<HTMLTableElement>(null)
  const [copyState, setCopyState] = React.useState<CopyState>("idle")
  const [fullscreenOpen, setFullscreenOpen] = React.useState(false)

  React.useEffect(() => {
    if (!fullscreenOpen) {
      return
    }
    const previousOverflow = document.body.style.overflow
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setFullscreenOpen(false)
      }
    }
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", onKey)
    }
  }, [fullscreenOpen])

  React.useEffect(() => {
    if (copyState === "idle") {
      return
    }
    const timer = window.setTimeout(() => setCopyState("idle"), 1600)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const markdown = React.useCallback((): string => {
    const table = tableRef.current
    if (!table) {
      return ""
    }
    return tableRowsToMarkdown(tableElementToRows(table))
  }, [])

  const handleCopy = React.useCallback(async () => {
    const text = markdown()
    if (!text) {
      setCopyState("error")
      return
    }
    try {
      await writeClipboardText(text)
      setCopyState("copied")
    } catch {
      setCopyState("error")
    }
  }, [markdown])

  const handleDownload = React.useCallback(() => {
    const text = markdown()
    if (!text) {
      return
    }
    downloadText("table.md", text, "text/markdown")
  }, [markdown])

  return (
    <div className="group/table my-3 min-w-0" data-lumo-markdown-table-wrapper="">
      <TableActions
        copyState={copyState}
        onCopy={() => void handleCopy()}
        onDownload={handleDownload}
        onFullscreen={() => setFullscreenOpen(true)}
        className="mb-1 justify-end"
      />
      <div className="min-w-0 overflow-x-auto rounded-md">
        <table
          ref={tableRef}
          className={cn("w-full min-w-max border-collapse border border-border text-sm", className)}
          data-streamdown="table"
          {...props}
        >
          {children}
        </table>
      </div>
      {fullscreenOpen ? (
        <TableFullscreen
          copyState={copyState}
          onClose={() => setFullscreenOpen(false)}
          onCopy={() => void handleCopy()}
          onDownload={handleDownload}
        >
          <table className={cn("w-full min-w-max border-collapse border border-border text-sm", className)}>
            {children}
          </table>
        </TableFullscreen>
      ) : null}
    </div>
  )
}

function TableActions({
  copyState,
  onCopy,
  onDownload,
  onFullscreen,
  onClose,
  className,
}: {
  copyState: CopyState
  onCopy: () => void
  onDownload: () => void
  onFullscreen?: () => void
  onClose?: () => void
  className?: string
}) {
  const CopyIcon = copyState === "copied" ? Check : Copy
  return (
    <div className={cn("flex items-center gap-1 [-webkit-app-region:no-drag]", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copyState === "copied" ? "Table copied" : "Copy table as Markdown"}
        title={copyState === "copied" ? "Table copied" : copyState === "error" ? "Copy failed" : "Copy table"}
        onClick={onCopy}
        className={cn("text-muted-foreground hover:text-foreground", copyState === "error" && "text-destructive")}
      >
        <CopyIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Download table as Markdown"
        title="Download table"
        onClick={onDownload}
        className="text-muted-foreground hover:text-foreground"
      >
        <Download className="size-4" />
      </Button>
      {onFullscreen ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Expand table"
          title="Expand table"
          onClick={onFullscreen}
          className="text-muted-foreground hover:text-foreground"
        >
          <Maximize2 className="size-4" />
        </Button>
      ) : null}
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close expanded table"
          title="Close"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}

function TableFullscreen({
  children,
  copyState,
  onClose,
  onCopy,
  onDownload,
}: {
  children: React.ReactNode
  copyState: CopyState
  onClose: () => void
  onCopy: () => void
  onDownload: () => void
}) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expanded table"
      className="fixed inset-0 z-50 flex flex-col bg-background [-webkit-app-region:no-drag]"
    >
      <header className="flex h-[calc(var(--app-titlebar-height)+2.25rem)] shrink-0 items-end justify-end px-4 pb-2 [-webkit-app-region:no-drag]">
        <TableActions
          copyState={copyState}
          onCopy={onCopy}
          onDownload={onDownload}
          onClose={onClose}
          className="rounded-md border border-border bg-background/90 p-1 shadow-sm supports-[backdrop-filter]:bg-background/75 supports-[backdrop-filter]:backdrop-blur"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <div className="min-w-full">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      fallbackCopyText(text)
      return
    }
  }
  fallbackCopyText(text)
}

function fallbackCopyText(text: string): void {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textarea)
  if (!copied) {
    throw new Error("Clipboard write failed")
  }
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
