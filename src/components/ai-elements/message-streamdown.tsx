import type { MermaidRendererControls } from "./mermaid-renderer.tsx"
import type {
  CustomRenderer,
  DiagramPlugin,
  LinkSafetyConfig,
  LinkSafetyModalProps,
  MermaidErrorComponentProps,
  StreamdownProps,
  StreamdownTranslations,
} from "streamdown"

import { createMermaidPlugin } from "@streamdown/mermaid"
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Streamdown } from "streamdown"
import {
  deferIncompleteMermaidMarkdown,
  incompleteMermaidLanguage,
  isRetryableMermaidError,
  mermaidParseErrorLine,
  validateMermaidSource,
} from "./mermaid-policy.ts"
import { MermaidPendingRenderer, MermaidRenderer, MermaidRendererProvider } from "./mermaid-renderer.tsx"
import { useTheme } from "@/components/theme-context"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
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

export function wrapMermaidPluginWithValidation(plugin: DiagramPlugin): DiagramPlugin {
  return {
    ...plugin,
    getMermaid(config) {
      const instance = plugin.getMermaid({
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
}

const safeMermaidPlugin = wrapMermaidPluginWithValidation(baseMermaidPlugin)

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

function useMermaidOptions(): NonNullable<StreamdownProps["mermaid"]> {
  const { effectiveTheme } = useTheme()
  const theme = effectiveTheme === "dark" ? "dark" : "neutral"

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

export function mermaidRendererControls(controls: StreamdownProps["controls"]): MermaidRendererControls {
  if (controls === false) {
    return { copy: false, fullscreen: false }
  }
  if (controls === true || controls === undefined) {
    return { copy: true, fullscreen: true }
  }
  const mermaid = controls.mermaid
  if (mermaid === false) {
    return { copy: false, fullscreen: false }
  }
  if (mermaid === true || mermaid === undefined) {
    return { copy: true, fullscreen: true }
  }
  return {
    copy: mermaid.copy !== false,
    fullscreen: mermaid.fullscreen !== false,
  }
}

/** Mermaid 控件由 Wanta 自己渲染，避免 Streamdown 再创建不符合窗口规范的全屏 Portal。 */
export function nativeMessageStreamdownControls(controls: StreamdownProps["controls"]): StreamdownProps["controls"] {
  if (controls === false) {
    return false
  }
  if (controls === true || controls === undefined) {
    return { table: true, code: true, mermaid: false }
  }
  return { ...controls, mermaid: false }
}

function useStreamdownTranslations(): Partial<StreamdownTranslations> {
  const t = useT()
  return {
    close: t("chat.diagramClose"),
    copied: t("chat.copiedMessage"),
    copyCode: t("chat.copyCode"),
    copyLink: t("chat.copyLink"),
    externalLinkWarning: t("chat.externalLinkWarning"),
    exitFullscreen: t("chat.diagramExitFullscreen"),
    openExternalLink: t("chat.openExternalLink"),
    openLink: t("chat.openLink"),
    viewFullscreen: t("chat.diagramFullscreen"),
  }
}

function MessageLinkSafetyModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copiedResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setCopied(false)
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current)
      copiedResetTimerRef.current = null
    }
    return () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
        copiedResetTimerRef.current = null
      }
    }
  }, [url])

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
      }
      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copiedResetTimerRef.current = null
      }, 2000)
    } catch {
      // Clipboard failures leave the action available for retry.
    }
  }

  const openLink = (): void => {
    onConfirm()
    onClose()
  }

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={
        <div className="oo-text-dialog-title flex items-center gap-2">
          <ExternalLinkIcon className="size-5" />
          <span>{t("chat.openExternalLink")}</span>
        </div>
      }
      description={t("chat.externalLinkWarning")}
      closeLabel={t("common.close")}
      className="max-w-md"
      footer={
        <>
          <Button type="button" variant="outline" className="flex-1" onClick={() => void copyLink()}>
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            {copied ? t("chat.copiedMessage") : t("chat.copyLink")}
          </Button>
          <Button type="button" className="flex-1" onClick={openLink}>
            <ExternalLinkIcon className="size-4" />
            {t("chat.openLink")}
          </Button>
        </>
      }
    >
      <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">{url}</div>
    </Dialog>
  )
}

function renderMessageLinkSafetyModal(props: LinkSafetyModalProps) {
  return <MessageLinkSafetyModal {...props} />
}

export function messageStreamdownLinkSafety(linkSafety?: LinkSafetyConfig): LinkSafetyConfig {
  return {
    enabled: true,
    ...linkSafety,
    renderModal: linkSafety?.renderModal ?? renderMessageLinkSafetyModal,
  }
}

export type MessageStreamdownProps = StreamdownProps & {
  defaultRenderers: CustomRenderer[]
}

export function MessageStreamdown({
  children,
  controls,
  defaultRenderers,
  linkSafety,
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
  const normalizedControls = messageStreamdownControls(controls)
  const normalizedLinkSafety = useMemo(() => messageStreamdownLinkSafety(linkSafety), [linkSafety])
  const streamdownChildren = typeof children === "string" ? deferIncompleteMermaidMarkdown(children) : children
  const diagramPlugin = useMemo(
    () => (plugins?.mermaid ? wrapMermaidPluginWithValidation(plugins.mermaid) : safeMermaidPlugin),
    [plugins?.mermaid],
  )
  const pluginRenderers = plugins?.renderers
  const renderers = useMemo(
    () => [
      ...(pluginRenderers ?? []),
      { language: incompleteMermaidLanguage, component: MermaidPendingRenderer },
      { language: "mermaid", component: MermaidRenderer },
      ...defaultRenderers,
    ],
    [defaultRenderers, pluginRenderers],
  )
  const streamdownPlugins = useMemo(
    () => ({
      ...plugins,
      mermaid: diagramPlugin,
      renderers,
    }),
    [diagramPlugin, plugins, renderers],
  )

  return (
    <MermaidRendererProvider
      config={mermaidOptions.config ?? {}}
      controls={mermaidRendererControls(normalizedControls)}
      errorComponent={mermaidOptions.errorComponent ?? MermaidError}
      plugin={diagramPlugin}
    >
      <Streamdown
        {...props}
        controls={nativeMessageStreamdownControls(normalizedControls)}
        linkSafety={normalizedLinkSafety}
        mermaid={mermaidOptions}
        plugins={streamdownPlugins}
        translations={{ ...localizedTranslations, ...translations }}
      >
        {streamdownChildren}
      </Streamdown>
    </MermaidRendererProvider>
  )
}
