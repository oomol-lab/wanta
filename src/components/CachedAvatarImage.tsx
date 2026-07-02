import type { ImgHTMLAttributes } from "react"

import * as React from "react"
import {
  clearAvatarImageFailure,
  dropCachedAvatarImage,
  loadCachedAvatarImage,
  markAvatarImageFailed,
  normalizeAvatarCacheKey,
  readCachedAvatarImage,
  refreshCachedAvatarImage,
  shouldFetchAvatarImage,
  shouldSkipAvatarImageLoad,
} from "@/lib/avatar-image-cache"
import { onOrganizationChanged } from "@/lib/organization-change-bus"
import { cn } from "@/lib/utils"

interface CachedAvatarImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | undefined
}

export function CachedAvatarImage({ className, onError, onLoad, src, style, ...props }: CachedAvatarImageProps) {
  const cacheKey = React.useMemo(() => normalizeAvatarCacheKey(src), [src])
  const [imageState, setImageState] = React.useState<{ cacheKey: string | null; src: string | null }>(() => ({
    cacheKey,
    src: cacheKey && !shouldFetchAvatarImage(cacheKey) ? cacheKey : readCachedAvatarImage(src),
  }))
  const imageSrc = imageState.cacheKey === cacheKey ? imageState.src : null
  const [visible, setVisible] = React.useState(false)
  const remoteFallbackRef = React.useRef(false)

  React.useEffect(() => {
    remoteFallbackRef.current = false
    setVisible(false)
    if (!cacheKey) {
      setImageState({ cacheKey, src: null })
      return
    }

    if (!shouldFetchAvatarImage(cacheKey)) {
      setImageState({ cacheKey, src: shouldSkipAvatarImageLoad(cacheKey) ? null : cacheKey })
      return
    }

    const cached = readCachedAvatarImage(cacheKey)
    if (cached) {
      setImageState({ cacheKey, src: cached })
      return
    }

    if (shouldSkipAvatarImageLoad(cacheKey)) {
      setImageState({ cacheKey, src: null })
      return
    }

    let cancelled = false
    setImageState({ cacheKey, src: null })
    void loadCachedAvatarImage(cacheKey)
      .then((nextSrc) => {
        if (!cancelled) {
          setVisible(false)
          setImageState({ cacheKey, src: nextSrc })
        }
      })
      .catch(() => {
        if (!cancelled) {
          remoteFallbackRef.current = true
          setVisible(false)
          setImageState({ cacheKey, src: cacheKey })
        }
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey])

  React.useEffect(() => {
    if (!cacheKey || !shouldFetchAvatarImage(cacheKey)) {
      return
    }

    let cancelled = false
    const unsubscribe = onOrganizationChanged(() => {
      setVisible(false)
      setImageState({ cacheKey, src: null })
      void refreshCachedAvatarImage(cacheKey)
        .then((nextSrc) => {
          if (!cancelled) {
            setVisible(false)
            setImageState({ cacheKey, src: nextSrc })
          }
        })
        .catch(() => {
          if (!cancelled) {
            remoteFallbackRef.current = true
            setVisible(false)
            setImageState({ cacheKey, src: cacheKey })
          }
        })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [cacheKey])

  if (!cacheKey || !imageSrc || imageState.cacheKey !== cacheKey) {
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
          setImageState({ cacheKey, src: cacheKey })
          return
        }
        markAvatarImageFailed(cacheKey)
        setVisible(false)
        setImageState({ cacheKey, src: null })
        onError?.(event)
      }}
    />
  )
}
