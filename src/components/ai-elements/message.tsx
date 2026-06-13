import type { UIMessage } from "ai"
import type { HTMLAttributes } from "react"
import type { StreamdownProps } from "streamdown"

import { lazy, memo, Suspense } from "react"
import { MarkdownTable } from "./markdown-table.tsx"
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
      "group flex w-full max-w-[95%] flex-col gap-2",
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

export type MessageResponseProps = StreamdownProps

const messageResponseComponents = {
  table: MarkdownTable,
} satisfies MessageResponseProps["components"]

export const MessageResponse = memo(
  ({ className, components, ...props }: MessageResponseProps) => (
    // fallback 直接铺原始 markdown 文本：streamdown chunk 首次加载时内容即可见，加载完再升级为富渲染。
    <Suspense fallback={<div className={cn("size-full whitespace-pre-wrap", className)}>{props.children}</div>}>
      <Streamdown
        className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        components={{ ...messageResponseComponents, ...components }}
        {...props}
      />
    </Suspense>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
)

MessageResponse.displayName = "MessageResponse"
