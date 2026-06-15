import type { UIMessage } from "ai"
import type { ComponentProps, HTMLAttributes } from "react"
import type { StreamdownProps } from "streamdown"

import { DownloadIcon } from "lucide-react"
import { lazy, memo, Suspense, useEffect, useState } from "react"
import { useChatService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// streamdown 拉入整套 markdown 渲染管线（micromark/remark/rehype + mermaid + katex，约 1.1MB）。
// 懒加载：聊天外壳先渲染，首条助手消息出现时才加载，不阻塞 AppShell 首帧。
const Streamdown = lazy(() => import("streamdown").then((m) => ({ default: m.Streamdown })))

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"]
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group group/message relative flex w-full flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionsProps = HTMLAttributes<HTMLDivElement>

export const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div
    className={cn(
      "pointer-events-none absolute top-full z-10 mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
      "group-[.is-user]:right-0 group-[.is-user]:justify-end",
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
  label: string
  tooltip?: string
  tooltipDelayDuration?: number
}

export const MessageAction = ({
  children,
  className,
  label,
  tooltip,
  tooltipDelayDuration = 500,
  ...props
}: MessageActionProps) => (
  <Tooltip delayDuration={tooltipDelayDuration}>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        className={cn("size-6 rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-3", className)}
        {...props}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{tooltip ?? label}</TooltipContent>
  </Tooltip>
)

export type MessageResponseProps = StreamdownProps

type MarkdownTableProps = ComponentProps<"table"> & {
  node?: unknown
}

type MarkdownImageProps = ComponentProps<"img"> & {
  node?: unknown
}

const localImagePreviewUrlByPath = new Map<string, string | null>()

function imageFileName(value: string | null | undefined): string {
  const fallback = "image"
  if (!value) {
    return fallback
  }
  try {
    const url = new URL(value)
    const name = url.pathname.split(/[\\/]/).pop()
    return name || fallback
  } catch {
    const name = value.split(/[\\/]/).pop()
    return name || fallback
  }
}

function localImagePathFromSrc(src: string | undefined): string | null {
  const value = src?.trim()
  if (!value || /^(?:https?:|data:|blob:|lumo:|lumo-local:)/i.test(value)) {
    return null
  }
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value)
      const decoded = decodeURIComponent(url.pathname)
      return /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded
    } catch {
      return null
    }
  }
  if (/^(?:~?[\\/]|[A-Za-z]:[\\/])/.test(value)) {
    return value
  }
  return null
}

function MarkdownTable({ children, className, node: _, ...props }: MarkdownTableProps) {
  return (
    <div className="my-3 min-w-0 overflow-x-auto">
      <table className={cn("w-full min-w-max border-collapse border border-border text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  )
}

function MarkdownImage({ src, alt, className, node: _, ...props }: MarkdownImageProps) {
  const chatService = useChatService()
  const localPath = typeof src === "string" ? localImagePathFromSrc(src) : null
  const originalSrc = typeof src === "string" ? src : undefined
  const [previewUrl, setPreviewUrl] = useState<string | null>(() =>
    localPath ? (localImagePreviewUrlByPath.get(localPath) ?? null) : null,
  )

  useEffect(() => {
    if (!localPath) {
      setPreviewUrl(null)
      return
    }
    const cached = localImagePreviewUrlByPath.get(localPath)
    if (cached !== undefined) {
      setPreviewUrl(cached)
      return
    }
    setPreviewUrl(null)
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: localPath, mime: "application/octet-stream" })
      .then((result) => {
        if (cancelled) {
          return
        }
        localImagePreviewUrlByPath.set(localPath, result.dataUrl)
        setPreviewUrl(result.dataUrl)
      })
      .catch(() => {
        if (!cancelled) {
          localImagePreviewUrlByPath.set(localPath, null)
          setPreviewUrl(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, localPath])

  const visibleSrc = localPath ? previewUrl : originalSrc
  const downloadName = imageFileName(localPath ?? originalSrc)

  if (!visibleSrc) {
    if (localPath) {
      return null
    }
    return <img src={src} alt={alt ?? ""} className={className} draggable={false} decoding="async" {...props} />
  }

  return (
    <figure className="oo-markdown-image-preview">
      <img src={visibleSrc} alt={alt ?? ""} className={className} draggable={false} decoding="async" {...props} />
      <div className="oo-markdown-image-actions">
        <a className="oo-markdown-image-action" href={visibleSrc} download={downloadName} aria-label="Download image">
          <DownloadIcon className="size-4" />
        </a>
      </div>
    </figure>
  )
}

const messageResponseComponents = {
  img: MarkdownImage,
  table: MarkdownTable,
} satisfies MessageResponseProps["components"]

function messageResponseControls(controls: MessageResponseProps["controls"]): MessageResponseProps["controls"] {
  if (controls === undefined) {
    return { table: false }
  }
  if (typeof controls === "boolean") {
    return controls
  }
  return { table: false, ...controls }
}

export const MessageResponse = memo(
  ({ className, components, controls, ...props }: MessageResponseProps) => (
    // fallback 直接铺原始 markdown 文本：streamdown chunk 首次加载时内容即可见，加载完再升级为富渲染。
    <Suspense fallback={<div className={cn("size-full whitespace-pre-wrap", className)}>{props.children}</div>}>
      <Streamdown
        className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        components={{ ...messageResponseComponents, ...components }}
        controls={messageResponseControls(controls)}
        {...props}
      />
    </Suspense>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
)

MessageResponse.displayName = "MessageResponse"
