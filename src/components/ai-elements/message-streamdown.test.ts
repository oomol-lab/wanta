import type { DiagramPlugin } from "streamdown"

import { describe, expect, it, vi } from "vitest"
import {
  mermaidRendererControls,
  messageStreamdownControls,
  nativeMessageStreamdownControls,
  wrapMermaidPluginWithValidation,
} from "./message-streamdown.tsx"

describe("messageStreamdownControls", () => {
  it("adds compact product-owned Mermaid controls without changing existing code controls", () => {
    expect(
      messageStreamdownControls({
        table: false,
        code: { copy: true, download: false },
      }),
    ).toEqual({
      table: false,
      code: { copy: true, download: false },
      mermaid: {
        copy: true,
        download: false,
        fullscreen: true,
        panZoom: false,
      },
    })
  })

  it("respects callers that explicitly disable Mermaid controls", () => {
    expect(messageStreamdownControls({ table: true, code: true, mermaid: false })).toEqual({
      table: true,
      code: true,
      mermaid: false,
    })
  })

  it("routes Mermaid controls to the Wanta renderer and disables the native fullscreen portal", () => {
    const controls = messageStreamdownControls({
      table: false,
      code: { copy: true, download: false },
      mermaid: { copy: false, fullscreen: true, panZoom: false },
    })

    expect(mermaidRendererControls(controls)).toEqual({ copy: false, fullscreen: true })
    expect(nativeMessageStreamdownControls(controls)).toEqual({
      table: false,
      code: { copy: true, download: false },
      mermaid: false,
    })
  })

  it("validates Mermaid source for caller-provided plugins", async () => {
    const render = vi.fn(async () => ({ diagramType: "flowchart", svg: "<svg />" }))
    const plugin = {
      getMermaid: vi.fn(() => ({ render })),
    } as unknown as DiagramPlugin
    const wrapped = wrapMermaidPluginWithValidation(plugin)
    const instance = wrapped.getMermaid({} as never)

    await expect(instance.render("diagram", "flowchart TD\nclick A https://example.com")).rejects.toThrow(
      "Mermaid click actions are not supported",
    )
    expect(render).not.toHaveBeenCalled()
  })
})
