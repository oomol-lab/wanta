import type { UIMessage } from "ai"
import type { ComponentProps, HTMLAttributes } from "react"
import type { CustomRendererProps, StreamdownProps } from "streamdown"

import { code as streamdownCode } from "@streamdown/code"
import { CheckIcon, CopyIcon } from "lucide-react"
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block.tsx"
import { MarkdownImage } from "./message-image.tsx"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

// streamdown 拉入整套 markdown 渲染管线（micromark/remark/rehype + mermaid + katex，约 1.1MB）。
// 懒加载：聊天外壳先渲染，首条助手消息出现时才加载，不阻塞 AppShell 首帧。
const Streamdown = lazy(() => import("streamdown").then((m) => ({ default: m.Streamdown })))
const localImagePathPattern =
  /(?:file:\/\/[^\s<>"'`，。；：、]+|(?:~?\/|[A-Za-z]:[\\/]).*?\.(?:avif|bmp|gif|jpe?g|png|svg|webp))(?=$|[\s<>"'`，。；：、,;:!?)\]])/gi
const localPathStartPattern = /^(?:file:\/\/|~?[\\/]|[A-Za-z]:[\\/])/
const singleLocalPathFencePattern =
  /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[ \t]*(?:text|txt|path|file)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\3[ \t]*(?=\n|$)/gi

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
      "flex max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:w-fit group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground",
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

export type MessageResponseProps = StreamdownProps & {
  /** 对正在生成的文本做前端平滑展示；不改变消息真实内容。 */
  smooth?: boolean
}

type MarkdownTableProps = ComponentProps<"table"> & {
  node?: unknown
}

type MarkdownInlineCodeProps = ComponentProps<"code"> & {
  node?: unknown
}

type MarkdownLocalPathProps = Omit<ComponentProps<"button">, "value"> & {
  value: string
}

function isSingleLocalPath(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && !trimmed.includes("\n") && !trimmed.includes("`") && localPathStartPattern.test(trimmed)
}

function inlineCodeText(children: MarkdownInlineCodeProps["children"]): string | null {
  if (typeof children === "string") {
    return children
  }
  if (Array.isArray(children) && children.every((child) => typeof child === "string")) {
    return children.join("")
  }
  return null
}

function normalizedLocalPath(value: string): string {
  const trimmed = value.trim()
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const decoded = decodeURIComponent(new URL(trimmed).pathname)
      return /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded
    } catch {
      // URL 解析失败时保留原始内容。
    }
  }
  return trimmed
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // 继续使用下方 DOM 兜底。
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.left = "-9999px"
  document.body.append(textarea)
  textarea.select()
  textarea.setSelectionRange(0, value.length)
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export function compactLocalPath(value: string, maxLength = 72): string {
  const normalized = normalizedLocalPath(value)
  if (normalized.length <= maxLength) {
    return normalized
  }
  const ellipsis = "..."
  const keep = Math.max(8, maxLength - ellipsis.length)
  const head = Math.ceil(keep * 0.45)
  const tail = keep - head
  return `${normalized.slice(0, head)}${ellipsis}${normalized.slice(-tail)}`
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

function MarkdownLocalPath({ className, value, ...props }: MarkdownLocalPathProps) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)
  const normalized = normalizedLocalPath(value)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const copyPath = async (): Promise<void> => {
    if (await writeClipboardText(normalized)) {
      setCopied(true)
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <Tooltip delayDuration={650}>
      <TooltipTrigger asChild>
        <button type="button" {...props} className={cn("oo-markdown-path-token", className)} aria-label={normalized}>
          <span className="oo-markdown-path-text">{compactLocalPath(normalized)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="oo-markdown-path-tooltip">
        <span className="oo-markdown-path-tooltip-text">{normalized}</span>
        <button
          type="button"
          className={cn("oo-markdown-path-tooltip-copy", copied && "is-copied")}
          aria-label={copied ? t("chat.copiedMessage") : t("chat.copyMessage")}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void copyPath()
          }}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </TooltipContent>
    </Tooltip>
  )
}

function MarkdownInlineCode({ children, className, node: _, ref: _ref, ...props }: MarkdownInlineCodeProps) {
  const text = inlineCodeText(children)

  if (text && isSingleLocalPath(text)) {
    return <MarkdownLocalPath {...props} className={className} value={text} />
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

const messageResponseComponents = {
  img: MarkdownImage,
  table: MarkdownTable,
} satisfies MessageResponseProps["components"]

const messageCodeBlockLanguages: string[] = [
  "bash",
  "c",
  "cpp",
  "cs",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "js",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "md",
  "php",
  "plain",
  "plaintext",
  "py",
  "python",
  "rb",
  "rs",
  "ruby",
  "rust",
  "scss",
  "sh",
  "shell",
  "sql",
  "text",
  "ts",
  "tsx",
  "txt",
  "typescript",
  "xml",
  "yaml",
  "yml",
  "zsh",
]

function codeBlockLanguageLabel(language: string): string {
  const normalized = language.trim().toLowerCase()
  switch (normalized) {
    case "js":
      return "javascript"
    case "md":
      return "markdown"
    case "py":
      return "python"
    case "rb":
      return "ruby"
    case "rs":
      return "rust"
    case "sh":
    case "shell":
    case "zsh":
      return "bash"
    case "ts":
      return "typescript"
    case "txt":
      return "text"
    default:
      return normalized || "text"
  }
}

function MarkdownCodeBlock({ code, language }: CustomRendererProps) {
  const t = useT()
  const label = codeBlockLanguageLabel(language)

  return (
    <CodeBlock className="my-3 w-full" code={code} language={language}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>{label}</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton aria-label={t("chat.copyCode")} />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  )
}

const defaultMessageCodeRenderers = [
  {
    component: MarkdownCodeBlock,
    language: messageCodeBlockLanguages,
  },
] satisfies NonNullable<MessageResponseProps["plugins"]>["renderers"]

const defaultMessageResponsePlugins = {
  code: streamdownCode,
  renderers: defaultMessageCodeRenderers,
} satisfies NonNullable<MessageResponseProps["plugins"]>

function messageResponsePlugins(plugins: MessageResponseProps["plugins"]): MessageResponseProps["plugins"] {
  if (!plugins) {
    return defaultMessageResponsePlugins
  }
  return {
    ...plugins,
    code: plugins.code ?? streamdownCode,
    renderers: [...(plugins.renderers ?? []), ...defaultMessageCodeRenderers],
  }
}

interface LocalImagePreview {
  path: string
  alt: string
}

function localImageAltText(value: string): string {
  let normalized = value.replace(/[\\/]+$/, "")
  if (/^file:\/\//i.test(normalized)) {
    try {
      normalized = decodeURIComponent(new URL(normalized).pathname)
    } catch {
      // Keep the original value when URL parsing fails.
    }
  }
  return normalized.split(/[\\/]/).pop() || "image"
}

function extractLocalImagePreviews(markdown: string): LocalImagePreview[] {
  const previews: LocalImagePreview[] = []
  for (const match of markdown.matchAll(localImagePathPattern)) {
    const candidate = match[0]?.trim()
    if (
      candidate &&
      !markdown.includes(`](${candidate})`) &&
      !markdown.includes(`](<${candidate}>)`) &&
      !previews.some((preview) => preview.path === candidate)
    ) {
      previews.push({ path: candidate, alt: localImageAltText(candidate) })
    }
  }
  return previews
}

export function normalizeSingleLocalPathCodeFences(markdown: string): string {
  return markdown.replace(
    singleLocalPathFencePattern,
    (match, prefix: string, indent: string, _fence: string, body: string) => {
      const value = body.trim()
      if (!isSingleLocalPath(value)) {
        return match
      }
      return `${prefix}${indent}\`${value}\``
    },
  )
}

const defaultMessageResponseControls = {
  table: false,
  code: {
    copy: true,
    download: false,
  },
} satisfies Exclude<MessageResponseProps["controls"], boolean | undefined>

export function messageResponseControls(controls: MessageResponseProps["controls"]): MessageResponseProps["controls"] {
  if (controls === undefined) {
    return defaultMessageResponseControls
  }
  if (typeof controls === "boolean") {
    return controls
  }
  return {
    ...defaultMessageResponseControls,
    ...controls,
    ...(typeof controls.code === "object"
      ? { code: { ...defaultMessageResponseControls.code, ...controls.code } }
      : {}),
  }
}

export function smoothedTextRevealStep(remaining: number): number {
  if (remaining > 1200) {
    return 24
  }
  if (remaining > 600) {
    return 16
  }
  if (remaining > 240) {
    return 10
  }
  if (remaining > 80) {
    return 6
  }
  return 3
}

export function nextSmoothedText(current: string, target: string): string {
  if (!target.startsWith(current) || current.length >= target.length) {
    return target
  }
  const remaining = target.length - current.length
  return target.slice(0, current.length + smoothedTextRevealStep(remaining))
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function useSmoothedText(target: string, enabled: boolean): string {
  const [visible, setVisible] = useState(enabled && !prefersReducedMotion() ? "" : target)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!enabled || prefersReducedMotion()) {
      setVisible(target)
      return
    }

    const tick = () => {
      setVisible((current) => {
        const next = nextSmoothedText(current, target)
        if (next.length < target.length) {
          timerRef.current = window.setTimeout(tick, 24)
        } else {
          timerRef.current = null
        }
        return next
      })
    }

    timerRef.current = window.setTimeout(tick, 24)
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [enabled, target])

  return visible
}

export const MessageResponse = memo(
  ({
    className,
    components,
    controls,
    children,
    lineNumbers,
    plugins,
    smooth = false,
    ...props
  }: MessageResponseProps) => {
    const visibleChildren = useSmoothedText(typeof children === "string" ? children : "", smooth)
    const sourceChildren = typeof children === "string" && smooth ? visibleChildren : children
    const responseChildren =
      typeof sourceChildren === "string" ? normalizeSingleLocalPathCodeFences(sourceChildren) : sourceChildren
    const localImagePreviews = typeof responseChildren === "string" ? extractLocalImagePreviews(responseChildren) : []
    return (
      // fallback 直接铺原始 markdown 文本：streamdown chunk 首次加载时内容即可见，加载完再升级为富渲染。
      <Suspense fallback={<div className={cn("size-full whitespace-pre-wrap", className)}>{responseChildren}</div>}>
        <>
          <Streamdown
            className={cn("oo-message-response size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
            components={{
              ...messageResponseComponents,
              inlineCode: MarkdownInlineCode,
              ...components,
            }}
            controls={messageResponseControls(controls)}
            lineNumbers={lineNumbers ?? false}
            plugins={messageResponsePlugins(plugins)}
            {...props}
          >
            {responseChildren}
          </Streamdown>
          {localImagePreviews.length > 0 ? (
            <div className="mt-3 grid gap-3">
              {localImagePreviews.map((preview) => (
                <MarkdownImage key={preview.path} src={preview.path} alt={preview.alt} />
              ))}
            </div>
          ) : null}
        </>
      </Suspense>
    )
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className &&
    prevProps.components === nextProps.components &&
    prevProps.controls === nextProps.controls &&
    prevProps.lineNumbers === nextProps.lineNumbers &&
    prevProps.plugins === nextProps.plugins &&
    prevProps.smooth === nextProps.smooth,
)

MessageResponse.displayName = "MessageResponse"
