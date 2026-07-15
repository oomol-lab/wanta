import { describe, expect, it } from "vitest"
import {
  clampDiagramViewerOffset,
  diagramViewerFitScale,
  diagramViewerWheelAction,
  mermaidSvgSize,
  panDiagramViewerState,
  pinchDiagramViewerState,
  zoomDiagramViewerState,
  zoomDiagramViewerToScale,
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
    expect(clampDiagramViewerOffset({ x: 2000, y: -2000 }, 1, diagram, stage)).toEqual({ x: 936, y: -636 })
    expect(clampDiagramViewerOffset({ x: 40, y: 40 }, 0.5, diagram, stage)).toEqual({ x: 40, y: 40 })
  })

  it("zooms and pans without leaving invalid offsets", () => {
    expect(zoomDiagramViewerState({ offset: { x: 200, y: 100 }, scale: 1 }, -0.5, diagram, stage)).toEqual({
      offset: { x: 100, y: 50 },
      scale: 0.5,
    })
    expect(panDiagramViewerState({ offset: { x: 0, y: 0 }, scale: 1 }, 80, -60, diagram, stage)).toEqual({
      offset: { x: 80, y: -60 },
      scale: 1,
    })
  })

  it("keeps the diagram point below the gesture anchor stationary while zooming", () => {
    const largeDiagram = { width: 2000, height: 1600 }
    expect(
      zoomDiagramViewerToScale({ offset: { x: 0, y: 0 }, scale: 1 }, 2, { x: 100, y: 50 }, largeDiagram, stage),
    ).toEqual({
      offset: { x: -100, y: -50 },
      scale: 2,
    })
  })

  it("combines pinch zoom with movement of the gesture midpoint", () => {
    expect(
      pinchDiagramViewerState(
        { offset: { x: 0, y: 0 }, scale: 1 },
        2,
        { x: 100, y: 0 },
        { x: 120, y: 10 },
        { width: 2000, height: 1600 },
        stage,
      ),
    ).toEqual({
      offset: { x: -80, y: 10 },
      scale: 2,
    })
  })

  it("maps precision scrolling to pan and modifier or wheel scrolling to zoom", () => {
    expect(diagramViewerWheelAction({ deltaX: 8, deltaY: 12 })).toEqual({ kind: "pan", deltaX: -8, deltaY: -12 })
    const trackpadPinch = diagramViewerWheelAction({ ctrlKey: true, deltaX: 0, deltaY: -10 })
    expect(trackpadPinch.kind).toBe("zoom")
    expect(trackpadPinch.kind === "zoom" ? trackpadPinch.factor : 0).toBeCloseTo(2 ** 0.2)
    expect(diagramViewerWheelAction({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toEqual({
      factor: 2 ** -0.15,
      kind: "zoom",
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
