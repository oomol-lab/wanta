import type { DiagramPlugin } from "streamdown"

import { describe, expect, it, vi } from "vitest"
import { renderMermaidSource, resolveMermaidPresentation } from "./mermaid-renderer.tsx"

function diagramPlugin(render: ReturnType<typeof vi.fn>): DiagramPlugin {
  return {
    getMermaid: vi.fn(() => ({ render })),
  } as unknown as DiagramPlugin
}

describe("renderMermaidSource", () => {
  it("does not parse an incomplete Mermaid fence", async () => {
    const render = vi.fn(async () => ({ svg: "<svg />" }))
    const plugin = diagramPlugin(render)

    await expect(
      renderMermaidSource({
        code: "flowchart TD\nA[Incomplete",
        config: {},
        id: "diagram",
        isIncomplete: true,
        plugin,
      }),
    ).resolves.toBeNull()
    expect(plugin.getMermaid).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it("renders a completed Mermaid fence", async () => {
    const render = vi.fn(async () => ({ svg: "<svg data-diagram />" }))
    const plugin = diagramPlugin(render)

    await expect(
      renderMermaidSource({
        code: "flowchart TD\nA[Complete]",
        config: {},
        id: "diagram",
        isIncomplete: false,
        plugin,
      }),
    ).resolves.toBe("<svg data-diagram />")
    expect(render).toHaveBeenCalledOnce()
  })

  it("preserves a final Mermaid parser failure", async () => {
    const render = vi.fn(async () => {
      throw new Error("Parse error on line 2")
    })

    await expect(
      renderMermaidSource({
        code: "flowchart TD\nA[",
        config: {},
        id: "diagram",
        isIncomplete: false,
        plugin: diagramPlugin(render),
      }),
    ).rejects.toThrow("Parse error on line 2")
  })
})

describe("resolveMermaidPresentation", () => {
  it("keeps incomplete source in a stable loading state", () => {
    expect(
      resolveMermaidPresentation(
        "flowchart TD\nA[Incomplete",
        true,
        { code: "flowchart TD\nA[Old]", svg: "<svg />" },
        { code: "flowchart TD\nA[Incomplete", error: "Parse error" },
      ),
    ).toEqual({ kind: "loading" })
  })

  it("does not flash an error from an older source revision", () => {
    expect(
      resolveMermaidPresentation("flowchart TD\nA[Corrected]", false, null, {
        code: "flowchart TD\nA[",
        error: "Parse error",
      }),
    ).toEqual({ kind: "loading" })
  })

  it("shows a failure only for the settled current source", () => {
    expect(
      resolveMermaidPresentation("flowchart TD\nA[", false, null, {
        code: "flowchart TD\nA[",
        error: "Parse error",
      }),
    ).toEqual({ kind: "error", error: "Parse error" })
  })
})
