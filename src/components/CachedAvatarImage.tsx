import type { ImgHTMLAttributes } from "react"

import * as React from "react"
import {
  clearAvatarImageFailure,
  dropCachedAvatarImage,
  loadCachedAvatarImage,
  markAvatarImageFailed,
  normalizeAvatarCacheKey,
  readCachedAvatarImage,
  shouldSkipAvatarImageLoad,
} from "@/lib/avatar-image-cache"
import { cn } from "@/lib/utils"

interface CachedAvatarImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | undefined
}

export function CachedAvatarImage({ className, onError, onLoad, src, style, ...props }: CachedAvatarImageProps) {
  const cacheKey = React.useMemo(() => normalizeAvatarCacheKey(src), [src])
  const [imageSrc, setImageSrc] = React.useState<string | null>(() => readCachedAvatarImage(src))
  const [visible, setVisible] = React.useState(false)
  const remoteFallbackRef = React.useRef(false)

  React.useEffect(() => {
    remoteFallbackRef.current = false
    setVisible(false)
    if (!cacheKey) {
      setImageSrc(null)
      return
    }

    const cached = readCachedAvatarImage(cacheKey)
    if (cached) {
      setImageSrc(cached)
      return
    }

    if (shouldSkipAvatarImageLoad(cacheKey)) {
      setImageSrc(null)
      return
    }

    let cancelled = false
    setImageSrc(null)
    void loadCachedAvatarImage(cacheKey)
      .then((nextSrc) => {
        if (!cancelled) {
          setVisible(false)
          setImageSrc(nextSrc)
        }
      })
      .catch(() => {
        if (!cancelled) {
          remoteFallbackRef.current = true
          setVisible(false)
          setImageSrc(cacheKey)
        }
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey])

  if (!cacheKey || !imageSrc) {
    return null
  }

  return (
    <img
      {...props}
      src={imageSrc}
      className={cn(className, !visible && "opacity-0")}
      style={style}
      draggable={props.draggable ?? false}
      referrerPolicy={props.referrerPolicy ?? "no-referrer"}
      onLoad={(event) => {
        clearAvatarImageFailure(cacheKey)
        setVisible(true)
        onLoad?.(event)
      }}
      onError={(event) => {
        if (!remoteFallbackRef.current && imageSrc !== cacheKey) {
          dropCachedAvatarImage(cacheKey)
          remoteFallbackRef.current = true
          setVisible(false)
          setImageSrc(cacheKey)
          return
        }
        markAvatarImageFailed(cacheKey)
        setVisible(false)
        setImageSrc(null)
        onError?.(event)
      }}
    />
  )
}
