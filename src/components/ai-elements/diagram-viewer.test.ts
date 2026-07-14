import { describe, expect, it } from "vitest"
import {
  clampDiagramViewerOffset,
  diagramViewerFitScale,
  diagramViewerWheelAction,
  mermaidSvgSize,
  panDiagramViewerState,
  zoomDiagramViewerState,
} from "./diagram-viewer.ts"

describe("diagramViewerFitScale", () => {
  it("fits a large diagram inside the available stage with a safe margin", () => {
    expect(diagramViewerFitScale({ width: 1000, height: 700 }, { width: 1800, height: 900 })).toBeCloseTo(904 / 1800)
  })

  it("does not over-enlarge a small diagram", () => {
    expect(diagramViewerFitScale({ width: 1600, height: 1000 }, { width: 400, height: 200 })).toBe(1.25)
  })
})

describe("diagram viewer navigation", () => {
  const diagram = { width: 1200, height: 800 }
  const stage = { width: 800, height: 600 }

  it("clamps panning to the rendered diagram bounds", () => {
    expect(clampDiagramViewerOffset({ x: 900, y: -900 }, 1, diagram, stage)).toEqual({ x: 200, y: -100 })
    expect(clampDiagramViewerOffset({ x: 40, y: 40 }, 0.5, diagram, stage)).toEqual({ x: 0, y: 0 })
  })

  it("zooms and pans without leaving invalid offsets", () => {
    expect(zoomDiagramViewerState({ offset: { x: 200, y: 100 }, scale: 1 }, -0.5, diagram, stage)).toEqual({
      offset: { x: 0, y: 0 },
      scale: 0.5,
    })
    expect(panDiagramViewerState({ offset: { x: 0, y: 0 }, scale: 1 }, 80, -60, diagram, stage)).toEqual({
      offset: { x: 80, y: -60 },
      scale: 1,
    })
  })

  it("maps precision scrolling to pan and modifier or wheel scrolling to zoom", () => {
    expect(diagramViewerWheelAction({ deltaX: 8, deltaY: 12 })).toEqual({ kind: "pan", deltaX: -8, deltaY: -12 })
    expect(diagramViewerWheelAction({ ctrlKey: true, deltaX: 0, deltaY: -10 })).toEqual({
      kind: "zoom",
      delta: 0.1,
    })
    expect(diagramViewerWheelAction({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toEqual({
      kind: "zoom",
      delta: -0.1,
    })
  })
})

describe("mermaidSvgSize", () => {
  it("prefers the Mermaid viewBox and falls back to explicit dimensions", () => {
    expect(mermaidSvgSize('<svg width="100%" viewBox="0 0 1480.5 720"></svg>')).toEqual({
      width: 1480.5,
      height: 720,
    })
    expect(mermaidSvgSize('<svg width="640px" height="360"></svg>')).toEqual({ width: 640, height: 360 })
    expect(mermaidSvgSize("<svg></svg>")).toBeNull()
  })
})
