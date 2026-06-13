import type { ComponentProps, HTMLAttributes } from "react"
import type { BundledLanguage, ShikiTransformer } from "shiki"
import type { HighlighterCore } from "shiki/core"

import { CheckIcon, CopyIcon } from "lucide-react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}

type CodeBlockContextType = {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
})

const lineNumberTransformer: ShikiTransformer = {
  name: "line-numbers",
  line(node, line) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        className: ["inline-block", "min-w-10", "mr-4", "text-right", "select-none", "text-muted-foreground"],
      },
      children: [{ type: "text", value: String(line) }],
    })
  },
}

// 全应用仅在工具调用面板里高亮 JSON。改用 shiki/core 并只按需加载 json 语法 + 两个主题，
// 避免 shiki 顶层 codeToHtml 拉入全量语言 bundle（vite 会因此产出 ~300 个无用语言 chunk，约 10MB）。
// 连 shiki/core 与 oniguruma 引擎也动态 import：首帧 / AppShell 外壳不再静态依赖 shiki，
// 仅在首次真正高亮代码块时才拉取。
let highlighterPromise: Promise<HighlighterCore> | undefined

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighter()
  return highlighterPromise
}

async function createHighlighter(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/oniguruma"),
  ])
  return createHighlighterCore({
    themes: [import("@shikijs/themes/one-light"), import("@shikijs/themes/one-dark-pro")],
    langs: [import("@shikijs/langs/json")],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  })
}

export async function highlightCode(code: string, _language: BundledLanguage, showLineNumbers = false) {
  const highlighter = await getHighlighter()
  const transformers: ShikiTransformer[] = showLineNumbers ? [lineNumberTransformer] : []

  return [
    highlighter.codeToHtml(code, { lang: "json", theme: "one-light", transformers }),
    highlighter.codeToHtml(code, { lang: "json", theme: "one-dark-pro", transformers }),
  ]
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>("")
  const [darkHtml, setDarkHtml] = useState<string>("")
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    setHtml("")
    setDarkHtml("")
    highlightCode(code, language, showLineNumbers)
      .then(([light, dark]) => {
        if (mounted.current) {
          setHtml(light)
          setDarkHtml(dark)
        }
      })
      .catch(() => {
        if (mounted.current) {
          setHtml("")
          setDarkHtml("")
        }
      })

    return () => {
      mounted.current = false
    }
  }, [code, language, showLineNumbers])

  const fallback = (
    <pre className="m-0 overflow-auto bg-background p-4 text-sm text-foreground">
      <code className="font-mono text-sm">{code}</code>
    </pre>
  )

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
          className,
        )}
        {...props}
      >
        <div className="relative">
          {html ? (
            <div
              className="overflow-auto dark:hidden [&_code]:font-mono [&_code]:text-sm [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&>pre]:text-foreground!"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="dark:hidden">{fallback}</div>
          )}
          {darkHtml ? (
            <div
              className="hidden overflow-auto dark:block [&_code]:font-mono [&_code]:text-sm [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&>pre]:text-foreground!"
              dangerouslySetInnerHTML={{ __html: darkHtml }}
            />
          ) : (
            <div className="hidden dark:block">{fallback}</div>
          )}
          {children && <div className="absolute top-2 right-2 flex items-center gap-2">{children}</div>}
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"))
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      onCopy?.()
      setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button className={cn("shrink-0", className)} onClick={copyToClipboard} size="icon" variant="ghost" {...props}>
      {children ?? <Icon size={14} />}
    </Button>
  )
}
