import type { ComponentProps } from "react"

import { DownloadIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useChatService } from "@/components/AppContext"

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

export function MarkdownImage({ src, alt, className, node: _, ...props }: MarkdownImageProps) {
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
