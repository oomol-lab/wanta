import * as React from "react"
import { useT } from "@/i18n/i18n"

function docxBlobUrls(...roots: HTMLElement[]): Set<string> {
  const urls = new Set<string>()
  for (const root of roots) {
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attribute of element.getAttributeNames()) {
        const value = element.getAttribute(attribute) ?? ""
        for (const match of value.matchAll(/blob:[^\s"')]+/gu)) {
          if (match[0]) urls.add(match[0])
        }
      }
    }
    for (const match of (root.textContent ?? "").matchAll(/blob:[^\s"')]+/gu)) {
      if (match[0]) urls.add(match[0])
    }
  }
  return urls
}

function revokeBlobUrls(urls: Set<string>): void {
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
}

export default function ArtifactDocxPreview({
  source,
  name,
  onResourceError,
}: {
  source: string
  name: string
  onResourceError?: () => void
}) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const styleContainerRef = React.useRef<HTMLDivElement | null>(null)
  const renderGenerationRef = React.useRef(0)
  const blobUrlsRef = React.useRef(new Set<string>())
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const container = containerRef.current
    const styleContainer = styleContainerRef.current
    if (!container || !styleContainer) {
      return
    }
    const generation = ++renderGenerationRef.current
    const controller = new AbortController()
    let cancelled = false
    revokeBlobUrls(blobUrlsRef.current)
    container.replaceChildren()
    styleContainer.replaceChildren()
    setError(null)
    void (async () => {
      const [{ renderAsync }, response] = await Promise.all([
        import("docx-preview"),
        fetch(source, { signal: controller.signal }),
      ])
      if (!response.ok) {
        throw new Error(`DOCX resource request failed with status ${response.status}`)
      }
      const buffer = await response.arrayBuffer()
      if (cancelled) {
        return
      }
      const nextContainer = document.createElement("div")
      const nextStyleContainer = document.createElement("div")
      await renderAsync(buffer, nextContainer, nextStyleContainer, {
        breakPages: true,
        className: "oo-docx-preview-doc",
        ignoreFonts: true,
        inWrapper: true,
        renderComments: false,
        renderEndnotes: true,
        renderFooters: true,
        renderFootnotes: true,
        renderHeaders: true,
        useBase64URL: false,
      })
      const nextBlobUrls = docxBlobUrls(nextContainer, nextStyleContainer)
      if (cancelled || renderGenerationRef.current !== generation) {
        revokeBlobUrls(nextBlobUrls)
        return
      }
      blobUrlsRef.current = nextBlobUrls
      container.replaceChildren(...Array.from(nextContainer.childNodes))
      styleContainer.replaceChildren(...Array.from(nextStyleContainer.childNodes))
    })().catch((cause: unknown) => {
      if (
        !cancelled &&
        renderGenerationRef.current === generation &&
        !(cause instanceof DOMException && cause.name === "AbortError")
      ) {
        setError(cause instanceof Error ? cause.message : String(cause))
        onResourceError?.()
      }
    })
    return () => {
      cancelled = true
      controller.abort()
      revokeBlobUrls(blobUrlsRef.current)
      container.replaceChildren()
      styleContainer.replaceChildren()
    }
  }, [onResourceError, source])

  return (
    <div className="flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)]">
      <div className="oo-border-divider flex h-10 shrink-0 items-center border-b bg-background px-3">
        <div className="oo-text-caption-compact truncate font-medium text-foreground">{name}</div>
      </div>
      {error ? (
        <div className="oo-text-body flex min-h-72 items-center justify-center px-4 py-8 text-center text-muted-foreground">
          {t("artifacts.previewReadFailed")}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div ref={containerRef} className="oo-docx-preview min-h-full min-w-fit p-4" />
      </div>
      <div ref={styleContainerRef} className="hidden" aria-hidden />
    </div>
  )
}
