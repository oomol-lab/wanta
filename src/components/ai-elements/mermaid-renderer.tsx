import type { DiagramViewerSize, DiagramViewerState } from "./diagram-viewer.ts"
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
  diagramViewerFitScale,
  diagramViewerMaxScale,
  diagramViewerMinScale,
  diagramViewerScaleStep,
  diagramViewerWheelAction,
  mermaidSvgSize,
  panDiagramViewerState,
  zoomDiagramViewerState,
} from "./diagram-viewer.ts"
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

interface DiagramViewerDragState {
  originX: number
  originY: number
  pointerId: number
  startX: number
  startY: number
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

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function MermaidRenderer({ code }: CustomRendererProps) {
  const t = useT()
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const { config, controls, errorComponent, plugin } = useMermaidRendererContext()
  const [svg, setSvg] = useState("")
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    mermaidRenderSequence += 1
    setError("")
    void plugin
      .getMermaid(config)
      .render(`wanta-mermaid-${renderId}-${retry}-${mermaidRenderSequence}`, code)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSvg("")
          setError(cause instanceof Error ? cause.message : "Failed to render Mermaid chart")
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, config, plugin, renderId, retry])

  const handleCopy = async (): Promise<void> => {
    if (!(await copyText(code))) {
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  const closeViewer = (): void => {
    setViewerOpen(false)
    window.requestAnimationFrame(() => fullscreenButtonRef.current?.focus())
  }

  if (error) {
    return createElement(errorComponent, { chart: code, error, retry: () => setRetry((value) => value + 1) })
  }

  if (!svg) {
    return (
      <div className="oo-mermaid-loading" aria-live="polite">
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
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
        />
      </div>
      {viewerOpen ? createPortal(<MermaidViewer code={code} onClose={closeViewer} svg={svg} />, document.body) : null}
    </div>
  )
}

function MermaidViewer({ code, onClose, svg }: { code: string; onClose: () => void; svg: string }) {
  const t = useT()
  const diagramSize = useMemo(() => mermaidSvgSize(svg) ?? { height: 600, width: 1000 }, [svg])
  const [stageSize, setStageSize] = useState<DiagramViewerSize>({ height: 0, width: 0 })
  const [viewerState, setViewerState] = useState<DiagramViewerState>({ offset: { x: 0, y: 0 }, scale: 1 })
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<DiagramViewerDragState | null>(null)
  const userAdjustedRef = useRef(false)

  const fitToWindow = useCallback((): void => {
    if (stageSize.width <= 0 || stageSize.height <= 0) {
      return
    }
    setViewerState({ offset: { x: 0, y: 0 }, scale: diagramViewerFitScale(stageSize, diagramSize) })
  }, [diagramSize, stageSize])

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
        setViewerState((current) => zoomDiagramViewerState(current, diagramViewerScaleStep, diagramSize, stageSize))
      } else if (event.key === "-") {
        event.preventDefault()
        userAdjustedRef.current = true
        setViewerState((current) => zoomDiagramViewerState(current, -diagramViewerScaleStep, diagramSize, stageSize))
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [diagramSize, fitToWindow, onClose, stageSize])

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

  const zoomBy = (delta: number): void => {
    userAdjustedRef.current = true
    setViewerState((current) => zoomDiagramViewerState(current, delta, diagramSize, stageSize))
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    userAdjustedRef.current = true
    const action = diagramViewerWheelAction(event)
    setViewerState((current) =>
      action.kind === "zoom"
        ? zoomDiagramViewerState(current, action.delta, diagramSize, stageSize)
        : panDiagramViewerState(current, action.deltaX, action.deltaY, diagramSize, stageSize),
    )
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      originX: viewerState.offset.x,
      originY: viewerState.offset.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    userAdjustedRef.current = true
    setDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    setViewerState((current) =>
      panDiagramViewerState(
        { ...current, offset: { x: drag.originX, y: drag.originY } },
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        diagramSize,
        stageSize,
      ),
    )
  }

  const stopDragging = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return
    }
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!(await copyText(code))) {
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
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
        onPointerCancel={stopDragging}
        onPointerDown={handlePointerDown}
        onLostPointerCapture={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null
            setDragging(false)
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
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
          onClick={() => zoomBy(-diagramViewerScaleStep)}
        >
          <MinusIcon className="size-4" />
        </button>
        <span className="oo-mermaid-viewer-percent">{Math.round(viewerState.scale * 100)}%</span>
        <button
          type="button"
          className="oo-mermaid-viewer-zoom-button"
          aria-label={t("chat.diagramZoomIn")}
          disabled={viewerState.scale >= diagramViewerMaxScale}
          onClick={() => zoomBy(diagramViewerScaleStep)}
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
