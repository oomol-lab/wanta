import { describe, expect, it } from "vitest"
import {
  mermaidRendererControls,
  messageStreamdownControls,
  nativeMessageStreamdownControls,
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
})
