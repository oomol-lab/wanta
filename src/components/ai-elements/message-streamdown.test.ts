import { describe, expect, it } from "vitest"
import { messageStreamdownControls } from "./message-streamdown.tsx"

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
})
