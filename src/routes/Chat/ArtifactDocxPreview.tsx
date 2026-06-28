import * as React from "react"
import { useT } from "@/i18n/i18n"

export default function ArtifactDocxPreview({ dataUrl, name }: { dataUrl: string; name: string }) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const controller = new AbortController()
    let cancelled = false
    container.replaceChildren()
    setError(null)
    void (async () => {
      const [{ renderAsync }, response] = await Promise.all([
        import("docx-preview"),
        fetch(dataUrl, { signal: controller.signal }),
      ])
      const buffer = await response.arrayBuffer()
      if (cancelled) {
        return
      }
      await renderAsync(buffer, container, container, {
        breakPages: true,
        className: "oo-docx-preview-doc",
        ignoreFonts: true,
        inWrapper: true,
        renderComments: false,
        renderEndnotes: true,
        renderFooters: true,
        renderFootnotes: true,
        renderHeaders: true,
        useBase64URL: true,
      })
    })().catch((cause: unknown) => {
      if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })
    return () => {
      cancelled = true
      controller.abort()
      container.replaceChildren()
    }
  }, [dataUrl])

  return (
    <div className="min-h-full bg-[var(--oo-artifact-preview-canvas)]">
      <div className="oo-border-divider sticky top-0 z-10 bg-background px-3 py-2">
        <div className="oo-text-caption-compact truncate font-medium text-foreground">{name}</div>
      </div>
      {error ? (
        <div className="oo-text-body flex min-h-72 items-center justify-center px-4 py-8 text-center text-muted-foreground">
          {t("artifacts.previewReadFailed")}
        </div>
      ) : null}
      <div ref={containerRef} className="oo-docx-preview min-h-full min-w-0 overflow-auto p-4" />
    </div>
  )
}
