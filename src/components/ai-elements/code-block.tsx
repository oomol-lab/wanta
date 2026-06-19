import type { ComponentProps, CSSProperties, HTMLAttributes } from "react"
import type { HighlighterCore, LanguageRegistration, ThemedToken } from "shiki/core"

import { CheckIcon, CopyIcon } from "lucide-react"
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const isItalic = (fontStyle: number | undefined) => fontStyle !== undefined && (fontStyle & 1) !== 0
const isBold = (fontStyle: number | undefined) => fontStyle !== undefined && (fontStyle & 2) !== 0
const isUnderline = (fontStyle: number | undefined) => fontStyle !== undefined && (fontStyle & 4) !== 0

interface KeyedToken {
  token: ThemedToken
  key: string
}

interface KeyedLine {
  tokens: KeyedToken[]
  key: string
}

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
  lines.map((line, lineIndex) => ({
    key: `line-${lineIndex}`,
    tokens: line.map((token, tokenIndex) => ({
      key: `line-${lineIndex}-${tokenIndex}`,
      token,
    })),
  }))

const TokenSpan = ({ token }: { token: ThemedToken }) => (
  <span
    className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
    style={
      {
        backgroundColor: token.bgColor,
        color: token.color,
        fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
        fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
        textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
        ...token.htmlStyle,
      } as CSSProperties
    }
  >
    {token.content}
  </span>
)

const lineNumberClassName = cn(
  "block",
  "before:inline-block",
  "before:w-8",
  "before:mr-4",
  "before:text-right",
  "before:font-mono",
  "before:text-muted-foreground/50",
  "before:select-none",
  "before:[counter-increment:line]",
  "before:content-[counter(line)]",
)

const LineSpan = ({ keyedLine, showLineNumbers }: { keyedLine: KeyedLine; showLineNumbers: boolean }) => (
  <span className={showLineNumbers ? lineNumberClassName : "block"}>
    {keyedLine.tokens.length === 0
      ? "\n"
      : keyedLine.tokens.map(({ token, key }) => <TokenSpan key={key} token={token} />)}
  </span>
)

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language?: string
  showLineNumbers?: boolean
}

interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

interface CodeBlockContextType {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
})

type SupportedLanguage =
  | "bash"
  | "c"
  | "csharp"
  | "css"
  | "diff"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "jsx"
  | "markdown"
  | "php"
  | "python"
  | "rust"
  | "scss"
  | "sql"
  | "tsx"
  | "typescript"
  | "xml"
  | "yaml"

type ResolvedLanguage = SupportedLanguage | "text"

type LanguageModule = {
  default: LanguageRegistration | LanguageRegistration[]
}

const languageLoaders = {
  bash: () => import("@shikijs/langs/shellscript"),
  c: () => import("@shikijs/langs/c"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
} satisfies Record<SupportedLanguage, () => Promise<LanguageModule>>

const languageAliases = new Map<string, ResolvedLanguage>([
  ["c#", "csharp"],
  ["cs", "csharp"],
  ["c++", "c"],
  ["cpp", "c"],
  ["cjs", "javascript"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["md", "markdown"],
  ["plain", "text"],
  ["plaintext", "text"],
  ["py", "python"],
  ["rb", "text"],
  ["ruby", "text"],
  ["rs", "rust"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["ts", "typescript"],
  ["txt", "text"],
  ["yml", "yaml"],
  ["zsh", "bash"],
])

let coreHighlighterPromise: Promise<HighlighterCore> | null = null
const highlighterCache = new Map<SupportedLanguage, Promise<HighlighterCore>>()
const tokensCache = new Map<string, TokenizedCode>()
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>()
const maxTokensCacheEntries = 300

function normalizeLanguage(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() || "text"
  if (normalized === "txt" || normalized === "text" || normalized === "plaintext") {
    return "text"
  }
  return normalized
}

function resolveSupportedLanguage(language: string | undefined): ResolvedLanguage | null {
  const normalized = normalizeLanguage(language)
  if (normalized === "text") {
    return "text"
  }
  const alias = languageAliases.get(normalized)
  if (alias) {
    return alias
  }
  if (normalized in languageLoaders) {
    return normalized as SupportedLanguage
  }
  return null
}

const getTokensCacheKey = (code: string, language: string): string => `${language}:${code}`

function getCachedTokens(key: string): TokenizedCode | undefined {
  const cached = tokensCache.get(key)
  if (!cached) {
    return undefined
  }
  tokensCache.delete(key)
  tokensCache.set(key, cached)
  return cached
}

function setCachedTokens(key: string, value: TokenizedCode): void {
  if (tokensCache.has(key)) {
    tokensCache.delete(key)
  }
  while (tokensCache.size >= maxTokensCacheEntries) {
    const oldestKey = tokensCache.keys().next().value as string | undefined
    if (!oldestKey) {
      break
    }
    tokensCache.delete(oldestKey)
  }
  tokensCache.set(key, value)
}

function languageRegistrations(module: LanguageModule): LanguageRegistration[] {
  return Array.isArray(module.default) ? module.default : [module.default]
}

function getCoreHighlighter(): Promise<HighlighterCore> {
  coreHighlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("@shikijs/themes/github-dark"),
    import("@shikijs/themes/github-light"),
  ]).then(([core, engine, githubDark, githubLight]) =>
    core.createHighlighterCore({
      engine: engine.createJavaScriptRegexEngine(),
      langs: [],
      themes: [githubLight.default, githubDark.default],
    }),
  )
  return coreHighlighterPromise
}

function getHighlighter(language: SupportedLanguage): Promise<HighlighterCore> {
  const cached = highlighterCache.get(language)
  if (cached) {
    return cached
  }

  const highlighterPromise = Promise.all([
    getCoreHighlighter(),
    languageLoaders[language]().then(languageRegistrations),
  ])
    .then(async ([highlighter, languages]) => {
      await highlighter.loadLanguage(...languages)
      return highlighter
    })
    .catch((error: unknown) => {
      highlighterCache.delete(language)
      throw error
    })

  highlighterCache.set(language, highlighterPromise)
  return highlighterPromise
}

const createRawTokens = (code: string): TokenizedCode => ({
  bg: "transparent",
  fg: "inherit",
  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
          } as ThemedToken,
        ],
  ),
})

function themedCssValue(property: "backgroundColor" | "color", value: string | undefined): CSSProperties {
  if (!value) {
    return {}
  }
  const [baseValue, ...declarations] = value.split(";")
  const style: Record<string, string> = {}
  if (baseValue) {
    style[property] = baseValue
  }
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":")
    if (separator <= 0) {
      continue
    }
    const name = declaration.slice(0, separator).trim()
    const declarationValue = declaration.slice(separator + 1).trim()
    if (name && declarationValue) {
      style[name] = declarationValue
    }
  }
  return style as CSSProperties
}

export function tokenizedCodeStyle(tokenized: Pick<TokenizedCode, "bg" | "fg">): CSSProperties {
  return {
    ...themedCssValue("backgroundColor", tokenized.bg),
    ...themedCssValue("color", tokenized.fg),
  }
}

export function highlightCode(
  code: string,
  language: string | undefined,
  callback?: (result: TokenizedCode) => void,
): TokenizedCode | null {
  const resolvedLanguage = resolveSupportedLanguage(language)
  if (!resolvedLanguage || resolvedLanguage === "text") {
    return null
  }

  const tokensCacheKey = getTokensCacheKey(code, resolvedLanguage)
  const cached = getCachedTokens(tokensCacheKey)
  if (cached) {
    return cached
  }

  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set())
    }
    subscribers.get(tokensCacheKey)?.add(callback)
  }

  void getHighlighter(resolvedLanguage)
    .then((highlighter) => {
      const result = highlighter.codeToTokens(code, {
        lang: resolvedLanguage,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
      })
      const tokenized: TokenizedCode = {
        bg: result.bg ?? "transparent",
        fg: result.fg ?? "inherit",
        tokens: result.tokens,
      }

      setCachedTokens(tokensCacheKey, tokenized)
      const cacheSubscribers = subscribers.get(tokensCacheKey)
      if (cacheSubscribers) {
        for (const subscriber of cacheSubscribers) {
          subscriber(tokenized)
        }
        subscribers.delete(tokensCacheKey)
      }
    })
    .catch(() => {
      subscribers.delete(tokensCacheKey)
    })

  return null
}

const CodeBlockBody = memo(
  ({
    tokenized,
    showLineNumbers,
    className,
  }: {
    tokenized: TokenizedCode
    showLineNumbers: boolean
    className?: string
  }) => {
    const preStyle = useMemo(() => tokenizedCodeStyle(tokenized), [tokenized])
    const keyedLines = useMemo(() => addKeysToTokens(tokenized.tokens), [tokenized.tokens])

    return (
      <pre
        className={cn(
          "m-0 min-w-max p-4 text-sm dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]",
          className,
        )}
        style={preStyle}
      >
        <code className={cn("font-mono text-sm", showLineNumbers && "[counter-increment:line_0] [counter-reset:line]")}>
          {keyedLines.map((keyedLine) => (
            <LineSpan key={keyedLine.key} keyedLine={keyedLine} showLineNumbers={showLineNumbers} />
          ))}
        </code>
      </pre>
    )
  },
  (prevProps, nextProps) =>
    prevProps.tokenized === nextProps.tokenized &&
    prevProps.showLineNumbers === nextProps.showLineNumbers &&
    prevProps.className === nextProps.className,
)

CodeBlockBody.displayName = "CodeBlockBody"

export const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
  <div
    className={cn("group relative w-full overflow-hidden rounded-md border bg-background text-foreground", className)}
    data-language={language}
    style={{
      containIntrinsicSize: "auto 200px",
      contentVisibility: "auto",
      ...style,
    }}
    {...props}
  />
)

export const CodeBlockHeader = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-between gap-3 border-b bg-muted/80 px-3 py-2 text-xs text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export const CodeBlockTitle = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
    {children}
  </div>
)

export const CodeBlockFilename = ({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("min-w-0 truncate font-mono", className)} {...props}>
    {children}
  </span>
)

export const CodeBlockActions = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex shrink-0 items-center gap-1", className)} {...props}>
    {children}
  </div>
)

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false,
}: {
  code: string
  language?: string
  showLineNumbers?: boolean
}) => {
  const normalizedLanguage = normalizeLanguage(language)
  const rawTokens = useMemo(() => createRawTokens(code), [code])
  const syncTokens = useMemo(
    () => highlightCode(code, normalizedLanguage) ?? rawTokens,
    [code, normalizedLanguage, rawTokens],
  )
  const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null)

  useEffect(() => {
    setAsyncTokens(null)
    let cancelled = false

    const highlighted = highlightCode(code, normalizedLanguage, (result) => {
      if (!cancelled) {
        setAsyncTokens(result)
      }
    })
    if (highlighted) {
      setAsyncTokens(highlighted)
    }

    return () => {
      cancelled = true
    }
  }, [code, normalizedLanguage])

  const tokenized = asyncTokens ?? syncTokens

  return (
    <div className="relative overflow-auto bg-background">
      <CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
    </div>
  )
}

export const CodeBlock = ({
  code,
  language = "text",
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const normalizedLanguage = normalizeLanguage(language)
  const contextValue = useMemo(() => ({ code }), [code])

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <CodeBlockContainer className={className} language={normalizedLanguage} {...props}>
        {children}
        <CodeBlockContent code={code} language={normalizedLanguage} showLineNumbers={showLineNumbers} />
      </CodeBlockContainer>
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
  timeout = 1200,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"))
      return
    }

    try {
      if (!isCopied) {
        await navigator.clipboard.writeText(code)
        setIsCopied(true)
        onCopy?.()
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout)
      }
    } catch (error) {
      onError?.(error as Error)
    }
  }, [code, onCopy, onError, timeout, isCopied])

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    [],
  )

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      type="button"
      className={cn("size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-4", className)}
      onClick={() => void copyToClipboard()}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon />}
    </Button>
  )
}

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>

export const CodeBlockLanguageSelector = (props: CodeBlockLanguageSelectorProps) => <Select {...props} />

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<typeof SelectTrigger>

export const CodeBlockLanguageSelectorTrigger = ({ className, ...props }: CodeBlockLanguageSelectorTriggerProps) => (
  <SelectTrigger
    className={cn("h-7 border-none bg-transparent px-2 text-xs shadow-none", className)}
    size="sm"
    {...props}
  />
)

export type CodeBlockLanguageSelectorValueProps = ComponentProps<typeof SelectValue>

export const CodeBlockLanguageSelectorValue = (props: CodeBlockLanguageSelectorValueProps) => <SelectValue {...props} />

export type CodeBlockLanguageSelectorContentProps = ComponentProps<typeof SelectContent>

export const CodeBlockLanguageSelectorContent = ({
  align = "end",
  ...props
}: CodeBlockLanguageSelectorContentProps) => <SelectContent align={align} {...props} />

export type CodeBlockLanguageSelectorItemProps = ComponentProps<typeof SelectItem>

export const CodeBlockLanguageSelectorItem = (props: CodeBlockLanguageSelectorItemProps) => <SelectItem {...props} />
