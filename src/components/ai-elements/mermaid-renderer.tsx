import type { DiagramViewerPoint, DiagramViewerSize, DiagramViewerState } from "./diagram-viewer.ts"
import type { MermaidConfig } from "@streamdown/mermaid"
import type { ComponentType, PointerEvent, ReactNode, WheelEvent } from "react"
import type { CustomRendererProps, DiagramPlugin, MermaidErrorComponentProps } from "streamdown"

import { CheckIcon, CopyIcon, Maximize2Icon, MinusIcon, PlusIcon, ScanIcon, XIcon } from "lucide-react"
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  diagramViewerButtonScaleFactor,
  diagramViewerFitScale,
  diagramViewerMaxScale,
  diagramViewerMinScale,
  diagramViewerWheelAction,
  mermaidSvgSize,
  panDiagramViewerState,
  pinchDiagramViewerState,
  zoomDiagramViewerToScale,
} from "./diagram-viewer.ts"
import { useClipboardCopy } from "@/hooks/useClipboardCopy"
import { useT } from "@/i18n/i18n"

export interface MermaidRendererControls {
  copy: boolean
  fullscreen: boolean
}

interface MermaidRendererContextValue {
  config: MermaidConfig
  controls: MermaidRendererControls
  errorComponent: ComponentType<MermaidErrorComponentProps>
  plugin: DiagramPlugin
}

interface MermaidRendererProviderProps extends MermaidRendererContextValue {
  children: ReactNode
}

interface MermaidRenderResult {
  code: string
  svg: string
}

interface MermaidRenderFailure {
  code: string
  error: string
}

export type MermaidPresentationState =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "diagram"; svg: string }

type DiagramViewerGestureState =
  | {
      kind: "pan"
      pointerId: number
      startPoint: DiagramViewerPoint
      startState: DiagramViewerState
    }
  | {
      kind: "pinch"
      pointerIds: [number, number]
      startDistance: number
      startMidpoint: DiagramViewerPoint
      startState: DiagramViewerState
    }

const MermaidRendererContext = createContext<MermaidRendererContextValue | null>(null)
let mermaidRenderSequence = 0

export function MermaidRendererProvider({
  children,
  config,
  controls,
  errorComponent,
  plugin,
}: MermaidRendererProviderProps) {
  const value = useMemo(
    () => ({ config, controls, errorComponent, plugin }),
    [config, controls, errorComponent, plugin],
  )
  return <MermaidRendererContext.Provider value={value}>{children}</MermaidRendererContext.Provider>
}

function useMermaidRendererContext(): MermaidRendererContextValue {
  const context = useContext(MermaidRendererContext)
  if (!context) {
    throw new Error("MermaidRenderer must be used within MermaidRendererProvider")
  }
  return context
}

export async function renderMermaidSource({
  code,
  config,
  id,
  isIncomplete,
  plugin,
}: {
  code: string
  config: MermaidConfig
  id: string
  isIncomplete: boolean
  plugin: DiagramPlugin
}): Promise<string | null> {
  if (isIncomplete) {
    return null
  }
  return (await plugin.getMermaid(config).render(id, code)).svg
}

export function resolveMermaidPresentation(
  code: string,
  isIncomplete: boolean,
  result: MermaidRenderResult | null,
  failure: MermaidRenderFailure | null,
): MermaidPresentationState {
  if (isIncomplete) {
    return { kind: "loading" }
  }
  if (failure?.code === code) {
    return { kind: "error", error: failure.error }
  }
  if (result?.code === code) {
    return { kind: "diagram", svg: result.svg }
  }
  return { kind: "loading" }
}

function pointDistance(first: DiagramViewerPoint, second: DiagramViewerPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function pointMidpoint(first: DiagramViewerPoint, second: DiagramViewerPoint): DiagramViewerPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export function MermaidRenderer({ code, isIncomplete }: CustomRendererProps) {
  const t = useT()
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const { config, controls, errorComponent, plugin } = useMermaidRendererContext()
  const [result, setResult] = useState<MermaidRenderResult | null>(null)
  const [failure, setFailure] = useState<MermaidRenderFailure | null>(null)
  const [retry, setRetry] = useState(0)
  const { copied, copyText } = useClipboardCopy({ failureMessage: t("error.copyFailed"), resetDelayMs: 2_000 })
  const [viewerOpen, setViewerOpen] = useState(false)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isIncomplete) {
      return
    }
    let cancelled = false
    mermaidRenderSequence += 1
    setFailure(null)
    void renderMermaidSource({
      code,
      config,
      id: `wanta-mermaid-${renderId}-${retry}-${mermaidRenderSequence}`,
      isIncomplete,
      plugin,
    })
      .then((svg) => {
        if (!cancelled) {
          if (svg !== null) {
            setResult({ code, svg })
          }
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult(null)
          setFailure({
            code,
            error: cause instanceof Error ? cause.message : "Failed to render Mermaid chart",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, config, isIncomplete, plugin, renderId, retry])

  const handleCopy = async (): Promise<void> => {
    await copyText(code)
  }

  const closeViewer = (): void => {
    setViewerOpen(false)
    window.requestAnimationFrame(() => fullscreenButtonRef.current?.focus())
  }

  const presentation = resolveMermaidPresentation(code, isIncomplete, result, failure)

  if (presentation.kind === "error") {
    return createElement(errorComponent, {
      chart: code,
      error: presentation.error,
      retry: () => {
        setFailure(null)
        setRetry((value) => value + 1)
      },
    })
  }

  if (presentation.kind === "loading") {
    return (
      <div className="oo-mermaid-loading" data-mermaid-state={isIncomplete ? "incomplete" : "rendering"}>
        {t("chat.diagramLoading")}
      </div>
    )
  }

  return (
    <div className="oo-mermaid-card" data-streamdown="mermaid-block">
      {controls.copy || controls.fullscreen ? (
        <div className="oo-mermaid-inline-actions" data-streamdown="mermaid-block-actions">
          {controls.copy ? (
            <button
              type="button"
              className="oo-mermaid-inline-action"
              aria-label={copied ? t("chat.copiedMessage") : t("chat.diagramCopy")}
              title={copied ? t("chat.copiedMessage") : t("chat.diagramCopy")}
              onClick={() => void handleCopy()}
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </button>
          ) : null}
          {controls.fullscreen ? (
            <button
              ref={fullscreenButtonRef}
              type="button"
              className="oo-mermaid-inline-action"
              aria-label={t("chat.diagramFullscreen")}
              title={t("chat.diagramFullscreen")}
              onClick={() => setViewerOpen(true)}
            >
              <Maximize2Icon className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="oo-mermaid-canvas" data-streamdown="mermaid">
        <div
          className="oo-mermaid-inline-diagram"
          aria-label={t("chat.diagramTitle")}
          dangerouslySetInnerHTML={{ __html: presentation.svg }}
          role="img"
        />
      </div>
      {viewerOpen
        ? createPortal(<MermaidViewer code={code} onClose={closeViewer} svg={presentation.svg} />, document.body)
        : null}
    </div>
  )
}

export function MermaidPendingRenderer(_props: CustomRendererProps) {
  const t = useT()
  return (
    <div className="oo-mermaid-loading" data-mermaid-state="incomplete">
      {t("chat.diagramLoading")}
    </div>
  )
}

function MermaidViewer({ code, onClose, svg }: { code: string; onClose: () => void; svg: string }) {
  const t = useT()
  const diagramSize = useMemo(() => mermaidSvgSize(svg) ?? { height: 600, width: 1000 }, [svg])
  const [stageSize, setStageSize] = useState<DiagramViewerSize>({ height: 0, width: 0 })
  const [viewerState, setViewerState] = useState<DiagramViewerState>({ offset: { x: 0, y: 0 }, scale: 1 })
  const { copied, copyText } = useClipboardCopy({ failureMessage: t("error.copyFailed"), resetDelayMs: 2_000 })
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const viewerStateRef = useRef(viewerState)
  const activePointersRef = useRef(new Map<number, DiagramViewerPoint>())
  const gestureRef = useRef<DiagramViewerGestureState | null>(null)
  const userAdjustedRef = useRef(false)

  const updateViewerState = useCallback((update: (current: DiagramViewerState) => DiagramViewerState): void => {
    setViewerState((current) => {
      const next = update(current)
      viewerStateRef.current = next
      return next
    })
  }, [])

  const fitToWindow = useCallback((): void => {
    if (stageSize.width <= 0 || stageSize.height <= 0) {
      return
    }
    updateViewerState(() => ({ offset: { x: 0, y: 0 }, scale: diagramViewerFitScale(stageSize, diagramSize) }))
  }, [diagramSize, stageSize, updateViewerState])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose()
        return
      }
      if (!(event.metaKey || event.ctrlKey)) {
        return
      }
      if (event.key === "0") {
        event.preventDefault()
        userAdjustedRef.current = false
        fitToWindow()
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault()
        userAdjustedRef.current = true
        updateViewerState((current) =>
          zoomDiagramViewerToScale(
            current,
            current.scale * diagramViewerButtonScaleFactor,
            { x: 0, y: 0 },
            diagramSize,
            stageSize,
          ),
        )
      } else if (event.key === "-") {
        event.preventDefault()
        userAdjustedRef.current = true
        updateViewerState((current) =>
          zoomDiagramViewerToScale(
            current,
            current.scale / diagramViewerButtonScaleFactor,
            { x: 0, y: 0 },
            diagramSize,
            stageSize,
          ),
        )
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [diagramSize, fitToWindow, onClose, stageSize, updateViewerState])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const updateSize = (): void => {
      const rect = stage.getBoundingClientRect()
      setStageSize({ height: rect.height, width: rect.width })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!userAdjustedRef.current) {
      fitToWindow()
    }
  }, [fitToWindow])

  const zoomBy = (factor: number): void => {
    userAdjustedRef.current = true
    updateViewerState((current) =>
      zoomDiagramViewerToScale(current, current.scale * factor, { x: 0, y: 0 }, diagramSize, stageSize),
    )
  }

  const stagePoint = (point: DiagramViewerPoint): DiagramViewerPoint => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) {
      return { x: 0, y: 0 }
    }
    return {
      x: point.x - rect.left - rect.width / 2,
      y: point.y - rect.top - rect.height / 2,
    }
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    userAdjustedRef.current = true
    const action = diagramViewerWheelAction(event)
    const anchor = stagePoint({ x: event.clientX, y: event.clientY })
    updateViewerState((current) =>
      action.kind === "zoom"
        ? zoomDiagramViewerToScale(current, current.scale * action.factor, anchor, diagramSize, stageSize)
        : panDiagramViewerState(current, action.deltaX, action.deltaY, diagramSize, stageSize),
    )
  }

  const startPan = (pointerId: number, point: DiagramViewerPoint): void => {
    gestureRef.current = {
      kind: "pan",
      pointerId,
      startPoint: point,
      startState: viewerStateRef.current,
    }
    setDragging(true)
  }

  const startPinch = (): void => {
    const pointers = Array.from(activePointersRef.current.entries()).slice(0, 2)
    if (pointers.length < 2) {
      return
    }
    const [[firstId, firstPoint], [secondId, secondPoint]] = pointers
    gestureRef.current = {
      kind: "pinch",
      pointerIds: [firstId, secondId],
      startDistance: Math.max(1, pointDistance(firstPoint, secondPoint)),
      startMidpoint: stagePoint(pointMidpoint(firstPoint, secondPoint)),
      startState: viewerStateRef.current,
    }
    setDragging(true)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = { x: event.clientX, y: event.clientY }
    activePointersRef.current.set(event.pointerId, point)
    if (activePointersRef.current.size >= 2) {
      startPinch()
    } else {
      startPan(event.pointerId, point)
    }
    userAdjustedRef.current = true
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!activePointersRef.current.has(event.pointerId)) {
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    activePointersRef.current.set(event.pointerId, point)
    const gesture = gestureRef.current
    if (!gesture) {
      return
    }
    if (gesture.kind === "pan") {
      if (gesture.pointerId !== event.pointerId) {
        return
      }
      updateViewerState(() =>
        panDiagramViewerState(
          gesture.startState,
          point.x - gesture.startPoint.x,
          point.y - gesture.startPoint.y,
          diagramSize,
          stageSize,
        ),
      )
      return
    }
    const [firstPoint, secondPoint] = gesture.pointerIds.map((pointerId) => activePointersRef.current.get(pointerId))
    if (!firstPoint || !secondPoint) {
      return
    }
    updateViewerState(() =>
      pinchDiagramViewerState(
        gesture.startState,
        pointDistance(firstPoint, secondPoint) / gesture.startDistance,
        gesture.startMidpoint,
        stagePoint(pointMidpoint(firstPoint, secondPoint)),
        diagramSize,
        stageSize,
      ),
    )
  }

  const finishPointer = (event: PointerEvent<HTMLDivElement>): void => {
    activePointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (activePointersRef.current.size >= 2) {
      startPinch()
      return
    }
    const remaining = activePointersRef.current.entries().next().value as [number, DiagramViewerPoint] | undefined
    if (remaining) {
      startPan(remaining[0], remaining[1])
      return
    }
    gestureRef.current = null
    setDragging(false)
  }

  const handleCopy = async (): Promise<void> => {
    await copyText(code)
  }

  return (
    <div className="oo-mermaid-viewer" role="dialog" aria-modal="true" aria-label={t("chat.diagramTitle")}>
      <header className="oo-mermaid-viewer-titlebar">
        <h2>{t("chat.diagramTitle")}</h2>
        <div className="oo-mermaid-viewer-actions">
          <button
            type="button"
            className="oo-mermaid-viewer-action"
            aria-label={copied ? t("chat.copiedMessage") : t("chat.diagramCopy")}
            title={copied ? t("chat.copiedMessage") : t("chat.diagramCopy")}
            onClick={() => void handleCopy()}
          >
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            className="oo-mermaid-viewer-action"
            aria-label={t("chat.diagramClose")}
            title={t("chat.diagramClose")}
            onClick={onClose}
          >
            <XIcon className="size-5" />
          </button>
        </div>
      </header>
      <div
        ref={stageRef}
        className={`oo-mermaid-viewer-stage${dragging ? " is-dragging" : ""}`}
        onDoubleClick={() => {
          userAdjustedRef.current = false
          fitToWindow()
        }}
        onPointerCancel={finishPointer}
        onPointerDown={handlePointerDown}
        onLostPointerCapture={finishPointer}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onWheel={handleWheel}
      >
        <div className="oo-mermaid-viewer-center">
          <div
            className="oo-mermaid-viewer-diagram"
            dangerouslySetInnerHTML={{ __html: svg }}
            style={{
              height: `${diagramSize.height}px`,
              transform: `translate(${viewerState.offset.x}px, ${viewerState.offset.y}px) scale(${viewerState.scale})`,
              width: `${diagramSize.width}px`,
            }}
          />
        </div>
      </div>
      <div className="oo-mermaid-viewer-zoom" aria-label={`${Math.round(viewerState.scale * 100)}%`}>
        <button
          type="button"
          className="oo-mermaid-viewer-zoom-button"
          aria-label={t("chat.diagramZoomOut")}
          disabled={viewerState.scale <= diagramViewerMinScale}
          onClick={() => zoomBy(1 / diagramViewerButtonScaleFactor)}
        >
          <MinusIcon className="size-4" />
        </button>
        <span className="oo-mermaid-viewer-percent">{Math.round(viewerState.scale * 100)}%</span>
        <button
          type="button"
          className="oo-mermaid-viewer-zoom-button"
          aria-label={t("chat.diagramZoomIn")}
          disabled={viewerState.scale >= diagramViewerMaxScale}
          onClick={() => zoomBy(diagramViewerButtonScaleFactor)}
        >
          <PlusIcon className="size-4" />
        </button>
        <span className="oo-mermaid-viewer-zoom-divider" />
        <button
          type="button"
          className="oo-mermaid-viewer-zoom-button"
          aria-label={t("chat.diagramFit")}
          title={t("chat.diagramFit")}
          onClick={() => {
            userAdjustedRef.current = false
            fitToWindow()
          }}
        >
          <ScanIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}
