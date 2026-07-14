export interface DiagramViewerSize {
  height: number
  width: number
}

export interface DiagramViewerOffset {
  x: number
  y: number
}

export interface DiagramViewerState {
  offset: DiagramViewerOffset
  scale: number
}

export type DiagramViewerWheelAction = { kind: "pan"; deltaX: number; deltaY: number } | { kind: "zoom"; delta: number }

export const diagramViewerMinScale = 0.1
export const diagramViewerMaxScale = 3
export const diagramViewerScaleStep = 0.1
const diagramViewerMargin = 48
const diagramViewerMaxFitScale = 1.25

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
  const maxX = Math.max(0, (diagramSize.width * scale - stageSize.width) / 2)
  const maxY = Math.max(0, (diagramSize.height * scale - stageSize.height) / 2)
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
): DiagramViewerState {
  const scale = clamp(current.scale + delta, diagramViewerMinScale, diagramViewerMaxScale)
  return {
    offset: clampDiagramViewerOffset(current.offset, scale, diagramSize, stageSize),
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
  if (event.ctrlKey || event.metaKey || (event.deltaMode ?? 0) !== 0 || Math.abs(event.deltaY) >= 48) {
    return { kind: "zoom", delta: -Math.sign(event.deltaY || 1) * diagramViewerScaleStep }
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
