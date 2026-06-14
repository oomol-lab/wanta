import type { UIMessage } from "ai"
import type { ComponentProps, HTMLAttributes } from "react"
import type { StreamdownProps } from "streamdown"

import { lazy, memo, Suspense } from "react"
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
        size="icon-xs"
        aria-label={label}
        className={cn("text-muted-foreground hover:text-foreground", className)}
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

function MarkdownTable({ children, className, node: _, ...props }: MarkdownTableProps) {
  return (
    <div className="my-3 min-w-0 overflow-x-auto rounded-md border border-border bg-background">
      <table className={cn("w-full min-w-max divide-y divide-border text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  )
}

const messageResponseComponents = {
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
