import type { ProcessActivityScrollState } from "./process-activity-scroll.ts"
import type { ReactNode } from "react"

import * as React from "react"
import { processActivityScrollState } from "./process-activity-scroll.ts"
import { cn } from "@/lib/utils"

const followLatestTolerancePx = 24

const initialScrollState: ProcessActivityScrollState = {
  atBottom: true,
  atTop: true,
  hasOverflow: false,
  remaining: 0,
}

export function ProcessActivityViewport({
  children,
  className,
  followKey,
  label,
  live,
}: {
  children: ReactNode
  className?: string
  followKey: string
  label: string
  live: boolean
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const followingLatestRef = React.useRef(true)
  const [scrollState, setScrollState] = React.useState(initialScrollState)

  const measure = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    if (live && followingLatestRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
    setScrollState(processActivityScrollState(viewport))
  }, [live])

  React.useEffect(() => {
    measure()
    if (typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver(measure)
    const viewport = viewportRef.current
    const content = contentRef.current
    if (viewport) {
      observer.observe(viewport)
    }
    if (content) {
      observer.observe(content)
    }
    return () => observer.disconnect()
  }, [followKey, measure])

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const next = processActivityScrollState(event.currentTarget)
    followingLatestRef.current = next.remaining <= followLatestTolerancePx
    setScrollState(next)
  }, [])

  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={viewportRef}
        aria-label={label}
        className="max-h-[min(20rem,40vh)] overflow-y-auto rounded-sm pr-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onScroll={handleScroll}
        role="region"
        tabIndex={scrollState.hasOverflow ? 0 : -1}
      >
        <div ref={contentRef} className="space-y-2 py-2">
          {children}
        </div>
      </div>
      {scrollState.hasOverflow && !scrollState.atTop ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background to-transparent"
        />
      ) : null}
      {scrollState.hasOverflow && !scrollState.atBottom ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent"
        />
      ) : null}
    </div>
  )
}
