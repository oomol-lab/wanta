export interface DiagramViewerSize {
  height: number
  width: number
}

export interface DiagramViewerOffset {
  x: number
  y: number
}

export type DiagramViewerPoint = DiagramViewerOffset

export interface DiagramViewerState {
  offset: DiagramViewerOffset
  scale: number
}

export type DiagramViewerWheelAction =
  | { kind: "pan"; deltaX: number; deltaY: number }
  | { factor: number; kind: "zoom" }

export const diagramViewerMinScale = 0.1
export const diagramViewerMaxScale = 4
export const diagramViewerButtonScaleFactor = 1.2
const diagramViewerMargin = 48
const diagramViewerMaxFitScale = 1.25
const diagramViewerMinimumVisible = 64

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function diagramViewerFitScale(stageSize: DiagramViewerSize, diagramSize: DiagramViewerSize): number {
  if (stageSize.width <= 0 || stageSize.height <= 0 || diagramSize.width <= 0 || diagramSize.height <= 0) {
    return 1
  }
  const availableWidth = Math.max(1, stageSize.width - diagramViewerMargin * 2)
  const availableHeight = Math.max(1, stageSize.height - diagramViewerMargin * 2)
  return clamp(
    Math.min(availableWidth / diagramSize.width, availableHeight / diagramSize.height, diagramViewerMaxFitScale),
    diagramViewerMinScale,
    diagramViewerMaxScale,
  )
}

export function clampDiagramViewerOffset(
  offset: DiagramViewerOffset,
  scale: number,
  diagramSize: DiagramViewerSize,
  stageSize: DiagramViewerSize,
): DiagramViewerOffset {
  const scaledWidth = diagramSize.width * scale
  const scaledHeight = diagramSize.height * scale
  const maxX = Math.max(0, (scaledWidth + stageSize.width) / 2 - Math.min(diagramViewerMinimumVisible, scaledWidth))
  const maxY = Math.max(0, (scaledHeight + stageSize.height) / 2 - Math.min(diagramViewerMinimumVisible, scaledHeight))
  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  }
}

export function zoomDiagramViewerState(
  current: DiagramViewerState,
  delta: number,
  diagramSize: DiagramViewerSize,
  stageSize: DiagramViewerSize,
  anchor: DiagramViewerPoint = { x: 0, y: 0 },
): DiagramViewerState {
  return zoomDiagramViewerToScale(current, current.scale + delta, anchor, diagramSize, stageSize)
}

export function zoomDiagramViewerToScale(
  current: DiagramViewerState,
  requestedScale: number,
  anchor: DiagramViewerPoint,
  diagramSize: DiagramViewerSize,
  stageSize: DiagramViewerSize,
): DiagramViewerState {
  const scale = clamp(requestedScale, diagramViewerMinScale, diagramViewerMaxScale)
  const ratio = scale / current.scale
  return {
    offset: clampDiagramViewerOffset(
      {
        x: anchor.x - (anchor.x - current.offset.x) * ratio,
        y: anchor.y - (anchor.y - current.offset.y) * ratio,
      },
      scale,
      diagramSize,
      stageSize,
    ),
    scale,
  }
}

export function pinchDiagramViewerState(
  start: DiagramViewerState,
  scaleRatio: number,
  startMidpoint: DiagramViewerPoint,
  currentMidpoint: DiagramViewerPoint,
  diagramSize: DiagramViewerSize,
  stageSize: DiagramViewerSize,
): DiagramViewerState {
  const scale = clamp(start.scale * scaleRatio, diagramViewerMinScale, diagramViewerMaxScale)
  const appliedRatio = scale / start.scale
  return {
    offset: clampDiagramViewerOffset(
      {
        x: currentMidpoint.x - (startMidpoint.x - start.offset.x) * appliedRatio,
        y: currentMidpoint.y - (startMidpoint.y - start.offset.y) * appliedRatio,
      },
      scale,
      diagramSize,
      stageSize,
    ),
    scale,
  }
}

export function panDiagramViewerState(
  current: DiagramViewerState,
  deltaX: number,
  deltaY: number,
  diagramSize: DiagramViewerSize,
  stageSize: DiagramViewerSize,
): DiagramViewerState {
  return {
    ...current,
    offset: clampDiagramViewerOffset(
      { x: current.offset.x + deltaX, y: current.offset.y + deltaY },
      current.scale,
      diagramSize,
      stageSize,
    ),
  }
}

export function diagramViewerWheelAction(event: {
  ctrlKey?: boolean
  deltaMode?: number
  deltaX: number
  deltaY: number
  metaKey?: boolean
  shiftKey?: boolean
}): DiagramViewerWheelAction {
  if (event.ctrlKey || event.metaKey) {
    // 沿用 d3-zoom 的默认 wheelDelta 曲线；Chromium 用 Ctrl+wheel 表达触控板捏合，因此放大十倍响应。
    const deltaModeFactor = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002
    const modifierFactor = event.ctrlKey ? 10 : 1
    return {
      factor: 2 ** (-event.deltaY * deltaModeFactor * modifierFactor),
      kind: "zoom",
    }
  }
  if ((event.deltaMode ?? 0) !== 0 || (Math.abs(event.deltaY) >= 48 && Math.abs(event.deltaX) < 1)) {
    const deltaModeFactor = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002
    return {
      factor: 2 ** (-event.deltaY * deltaModeFactor),
      kind: "zoom",
    }
  }
  if (event.shiftKey) {
    return { kind: "pan", deltaX: -event.deltaY, deltaY: 0 }
  }
  return { kind: "pan", deltaX: -event.deltaX, deltaY: -event.deltaY }
}

export function mermaidSvgSize(svg: string): DiagramViewerSize | null {
  const viewBox = svg.match(/\bviewBox=["']\s*[-+\d.eE]+[ ,]+[-+\d.eE]+[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*["']/iu)
  if (viewBox) {
    const width = Number(viewBox[1])
    const height = Number(viewBox[2])
    if (width > 0 && height > 0) {
      return { height, width }
    }
  }
  const width = Number(svg.match(/\bwidth=["']([\d.]+)(?:px)?["']/iu)?.[1])
  const height = Number(svg.match(/\bheight=["']([\d.]+)(?:px)?["']/iu)?.[1])
  return width > 0 && height > 0 ? { height, width } : null
}
