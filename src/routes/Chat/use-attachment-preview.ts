import type { ChatAttachment, AttachmentPreviewResult } from "../../../electron/chat/common.ts"

import * as React from "react"
import {
  deleteAttachmentPreviewUrl,
  readAttachmentPreviewUrl,
  setAttachmentPreviewUrl,
} from "./chat-attachment-utils.ts"
import { useChatService } from "@/components/AppContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

type PreviewReason = NonNullable<AttachmentPreviewResult["reason"]> | "unavailable" | "decode_failed"
type PreviewState = {
  path: string
  src: string | null
  status: "loading" | "ready" | "failed"
  reason?: PreviewReason
}
export const attachmentPreviewRetryDelaysMs = [250, 750, 1_500, 3_000] as const

/** One owner for thumbnail and viewer, including URL renewal and bounded recovery. */
export function useAttachmentPreview(attachment: ChatAttachment) {
  const service = useChatService()
  const { path, mime, id } = attachment
  const [state, setState] = React.useState<PreviewState>({ path, src: null, status: "loading" })
  const controls = React.useRef({
    retry: () => {},
    revalidate: () => {},
    failed: (_src: string) => {},
    loaded: (_src: string) => {},
  })

  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    let attempts = 0
    let currentSrc: string | null = null
    let busy = false
    const publish = (next: Omit<PreviewState, "path">) => {
      if (!cancelled) setState({ path, ...next })
    }
    const invalidate = () => {
      // Another mounted consumer may already have refreshed this cache entry.
      if (!currentSrc || readAttachmentPreviewUrl(path) === currentSrc) deleteAttachmentPreviewUrl(path)
      currentSrc = null
    }
    const fail = (reason: PreviewReason, retryable: boolean, cause?: unknown) => {
      if (cancelled) return
      invalidate()
      const delay = retryable ? attachmentPreviewRetryDelaysMs[attempts] : undefined
      reportRendererHandledError(
        "chat.attachmentPreview",
        `Attachment ${id}: ${reason}, attempt ${attempts}`,
        cause ?? reason,
      )
      if (delay === undefined) {
        busy = false
        publish({ src: null, status: "failed", reason })
        return
      }
      attempts += 1
      busy = true
      publish({ src: null, status: "loading" })
      timer = setTimeout(() => void load(), delay)
    }
    const load = async () => {
      if (cancelled) return
      const version = ++request
      busy = true
      publish({ src: null, status: "loading" })
      try {
        const result = await service.invoke("getAttachmentPreview", { path, mime })
        if (cancelled || version !== request) return
        const src = result.resourceUrl ?? result.dataUrl
        if (!src) {
          const reason = result.reason ?? "read_failed"
          fail(reason, reason === "read_failed" || reason === "missing")
          return
        }
        currentSrc = src
        busy = false
        setAttachmentPreviewUrl(path, src, result.resourceExpiresAt)
        publish({ src, status: "ready" })
      } catch (cause) {
        if (cancelled || version !== request) return
        // Access denial is terminal; explicit retry still rechecks the main-process boundary.
        const denied =
          cause instanceof Error && cause.message.includes("Local path is not available from this conversation")
        fail(denied ? "unavailable" : "read_failed", !denied, cause)
      }
    }
    const restart = () => {
      clearTimeout(timer)
      invalidate()
      attempts = 0
      void load()
    }
    controls.current = {
      retry: restart,
      revalidate: () => {
        if (!busy && (!currentSrc || readAttachmentPreviewUrl(path) !== currentSrc)) restart()
      },
      failed: (src) => {
        if (currentSrc !== src || busy) return
        fail("decode_failed", true)
      },
      loaded: (src) => {
        if (currentSrc === src) attempts = 0
      },
    }
    const cached = readAttachmentPreviewUrl(path)
    if (cached) {
      currentSrc = cached
      publish({ src: cached, status: "ready" })
    } else {
      void load()
    }
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [id, mime, path, service])

  return {
    ...(state.path === path ? state : { path, src: null, status: "loading" as const }),
    retry: () => controls.current.retry(),
    revalidate: () => controls.current.revalidate(),
    failed: (src: string) => controls.current.failed(src),
    loaded: (src: string) => controls.current.loaded(src),
  }
}
