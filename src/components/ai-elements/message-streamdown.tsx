import type {
  CustomRenderer,
  DiagramPlugin,
  MermaidErrorComponentProps,
  StreamdownProps,
  StreamdownTranslations,
} from "streamdown"

import { createMermaidPlugin } from "@streamdown/mermaid"
import { useEffect, useMemo, useState } from "react"
import { Streamdown } from "streamdown"
import { isRetryableMermaidError, mermaidParseErrorLine, validateMermaidSource } from "./mermaid-policy.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

const baseMermaidPlugin = createMermaidPlugin({
  config: {
    fontFamily:
      '-apple-system, "BlinkMacSystemFont", "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif',
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
  },
})

const safeMermaidPlugin: DiagramPlugin = {
  ...baseMermaidPlugin,
  getMermaid(config) {
    const instance = baseMermaidPlugin.getMermaid({
      ...config,
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
    })
    return {
      ...instance,
      async render(id, source) {
        validateMermaidSource(source)
        return await instance.render(id, source)
      },
    }
  },
}

function MermaidError({ chart, error, retry }: MermaidErrorComponentProps) {
  const t = useT()
  const parseErrorLine = mermaidParseErrorLine(error)
  const retryable = isRetryableMermaidError(error)

  return (
    <div className="oo-mermaid-error" role="alert">
      <div className="oo-mermaid-error-header">
        <div>
          <p className="oo-mermaid-error-title">{t("chat.diagramErrorTitle")}</p>
          <p className="oo-mermaid-error-description">
            {parseErrorLine === null
              ? t("chat.diagramErrorDescription")
              : t("chat.diagramSyntaxErrorLine", { line: parseErrorLine })}
          </p>
        </div>
        {retryable ? (
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t("chat.diagramRetry")}
          </Button>
        ) : null}
      </div>
      <details className="oo-mermaid-error-details">
        <summary>{t("chat.diagramShowSource")}</summary>
        <pre>{chart}</pre>
        <p>{error}</p>
      </details>
    </div>
  )
}

function currentMermaidTheme(): "dark" | "neutral" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "neutral"
}

function useMermaidOptions(): NonNullable<StreamdownProps["mermaid"]> {
  const [theme, setTheme] = useState<"dark" | "neutral">(currentMermaidTheme)

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(currentMermaidTheme()))
    observer.observe(root, { attributeFilter: ["class"], attributes: true })
    return () => observer.disconnect()
  }, [])

  return useMemo(
    () => ({
      config: {
        fontFamily:
          '-apple-system, "BlinkMacSystemFont", "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif',
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
        theme,
      },
      errorComponent: MermaidError,
    }),
    [theme],
  )
}

const defaultMermaidControls = {
  copy: true,
  download: false,
  fullscreen: true,
  panZoom: false,
}

export function messageStreamdownControls(controls: StreamdownProps["controls"]): StreamdownProps["controls"] {
  if (controls === false) {
    return false
  }
  if (controls === true || controls === undefined) {
    return {
      table: true,
      code: true,
      mermaid: defaultMermaidControls,
    }
  }
  if (controls.mermaid === false) {
    return controls
  }
  return {
    ...controls,
    mermaid: {
      ...defaultMermaidControls,
      ...(typeof controls.mermaid === "object" ? controls.mermaid : {}),
    },
  }
}

function useStreamdownTranslations(): Partial<StreamdownTranslations> {
  const t = useT()
  return {
    close: t("chat.diagramClose"),
    copied: t("chat.copiedMessage"),
    copyCode: t("chat.copyCode"),
    exitFullscreen: t("chat.diagramExitFullscreen"),
    viewFullscreen: t("chat.diagramFullscreen"),
  }
}

export type MessageStreamdownProps = StreamdownProps & {
  defaultRenderers: CustomRenderer[]
}

export function MessageStreamdown({
  controls,
  defaultRenderers,
  mermaid,
  plugins,
  translations,
  ...props
}: MessageStreamdownProps) {
  const localizedTranslations = useStreamdownTranslations()
  const defaultMermaidOptions = useMermaidOptions()
  const mermaidOptions = useMemo<NonNullable<StreamdownProps["mermaid"]>>(
    () => ({
      config: {
        ...defaultMermaidOptions.config,
        ...mermaid?.config,
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
      },
      errorComponent: mermaid?.errorComponent ?? defaultMermaidOptions.errorComponent,
    }),
    [defaultMermaidOptions, mermaid],
  )
  const renderers = [...(plugins?.renderers ?? []), ...defaultRenderers]

  return (
    <Streamdown
      {...props}
      controls={messageStreamdownControls(controls)}
      mermaid={mermaidOptions}
      plugins={{
        ...plugins,
        mermaid: plugins?.mermaid ?? safeMermaidPlugin,
        renderers,
      }}
      translations={{ ...localizedTranslations, ...translations }}
    />
  )
}
