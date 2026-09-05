// @vitest-environment happy-dom
import type { MessageStreamdownProps } from "./message-streamdown.tsx"

import * as React from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { MessageResponse } from "./message.tsx"

const rendered = vi.hoisted(() => ({ props: [] as MessageStreamdownProps[] }))
vi.mock("./message-streamdown.tsx", () => ({
  MessageStreamdown: (props: MessageStreamdownProps) => {
    rendered.props.push(props)
    return React.createElement("div", null, props.children)
  },
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test("text updates reuse Markdown components while explicit overrides still update", async () => {
  const root = createRoot(document.createElement("div"))
  rendered.props.length = 0
  const Inline = ({ children }: { children?: React.ReactNode }) => React.createElement("code", null, children)
  try {
    await React.act(async () => {
      root.render(React.createElement(MessageResponse, null, "First paragraph."))
    })
    const defaults = rendered.props.at(-1)?.components
    expect(defaults?.inlineCode).toBeDefined()
    expect(defaults?.img).toBeDefined()
    await React.act(async () => {
      root.render(React.createElement(MessageResponse, null, "First paragraph. More text."))
    })
    expect(rendered.props.at(-1)?.components).toBe(defaults)

    const overrides = { inlineCode: Inline }
    await React.act(async () => {
      root.render(React.createElement(MessageResponse, { components: overrides }, "First paragraph. More text."))
    })
    const custom = rendered.props.at(-1)?.components
    expect(custom).not.toBe(defaults)
    expect(custom?.inlineCode).toBe(Inline)
    expect(custom?.img).toBe(defaults?.img)
    await React.act(async () => {
      root.render(React.createElement(MessageResponse, { components: overrides }, "Continued output."))
    })
    expect(rendered.props.at(-1)?.components).toBe(custom)
    await React.act(async () => {
      root.render(React.createElement(MessageResponse, null, "Continued output."))
    })
    expect(rendered.props.at(-1)?.components?.inlineCode).toBe(defaults?.inlineCode)
  } finally {
    await React.act(async () => root.unmount())
  }
})
