import type { ChatMessagePart } from "../../../electron/chat/common.ts"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { I18nContext, translate } from "../../i18n/i18n.ts"
import { ToolActivityStep } from "./ToolActivityStep.tsx"

function renderToolActivityStep(part: ChatMessagePart): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      {
        value: {
          locale: "zh-CN",
          setLocale: () => undefined,
          t: (key, vars) => translate("zh-CN", key, vars),
        },
      },
      React.createElement(ToolActivityStep, { part, onAuthorize: () => undefined }),
    ),
  )
}

function shimmerClassFor(html: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = html.match(new RegExp(`class="([^"]*text-transparent[^"]*)"[^>]*>${escaped}</span>`))
  if (!match?.[1]) {
    throw new Error(`Missing shimmer span for ${text}.`)
  }
  return match[1]
}

describe("ToolActivityStep", () => {
  it("shimmers only the active tool title when a command is shown inline", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "bash",
      status: "running",
      input: { command: "curl -s -L -o /tmp/1688_page.html" },
    })

    expect(html).toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>运行命令<\/span>/)
    expect(shimmerClassFor(html, "运行命令")).toContain("shrink-0")
    expect(shimmerClassFor(html, "运行命令")).not.toContain("flex-1")
    expect(html).toMatch(/<code class="[^"]*"[^>]*>curl -s -L -o \/tmp\/1688_page\.html<\/code>/)
    expect(html).not.toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>[^<]*curl/)
  })

  it("shimmers only the active web fetch title when the URL is shown inline", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "webfetch",
      status: "running",
      input: { url: "https://detail.1688.com/offer/825951472006.html" },
    })

    expect(html).toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>读取网页<\/span>/)
    expect(shimmerClassFor(html, "读取网页")).toContain("shrink-0")
    expect(shimmerClassFor(html, "读取网页")).not.toContain("flex-1")
    expect(html).toContain("https://detail.1688.com/offer/825951472006.html")
    expect(html).not.toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>[^<]*1688/)
  })

  it("shimmers only the active file tool title when a path is shown inline", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "read",
      status: "running",
      input: { filePath: "/tmp/a.txt" },
    })

    expect(html).toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>读取文件<\/span>/)
    expect(shimmerClassFor(html, "读取文件")).toContain("shrink-0")
    expect(html).toContain("/tmp/a.txt")
    expect(html).not.toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>[^<]*\/tmp/)
  })

  it("shimmers only the active connector title when a connector target is shown inline", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "call_action",
      status: "pending",
      input: { service: "gmail", action: "send_email" },
    })

    expect(html).toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>调用连接器<\/span>/)
    expect(shimmerClassFor(html, "调用连接器")).toContain("shrink-0")
    expect(html).toContain("gmail · send_email")
    expect(html).not.toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>[^<]*gmail/)
  })

  it("keeps the active title shimmer width stable when no inline detail is available", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "bash",
      status: "pending",
      input: {},
    })

    expect(shimmerClassFor(html, "运行命令")).toContain("shrink-0")
    expect(shimmerClassFor(html, "运行命令")).not.toContain("flex-1")
    expect(html).toContain('aria-hidden="true"')
  })

  it("does not shimmer a completed tool row", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "webfetch",
      status: "completed",
      input: { url: "https://detail.1688.com/offer/825951472006.html" },
    })

    expect(html).toContain("读取网页")
    expect(html).toContain("https://detail.1688.com/offer/825951472006.html")
    expect(html).not.toContain("text-transparent")
  })

  it("keeps completed tool rows static while the turn is still transitioning", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "todo_write",
      status: "completed",
      input: {},
      title: "4 todos",
    })

    expect(html).not.toContain("text-transparent")
    expect(html).toContain("4 todos")
    expect(html).toContain("已完成")
  })

  it("keeps an incomplete tool collapsed and uses a neutral status treatment", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "grep",
      status: "error",
      input: { pattern: 'https?://[^\\"<> ]+\\.(jpg|jpeg|png|webp)' },
      error: "Ripgrep JSON record exceeded 65536 bytes",
    })

    expect(html).toContain("未完成")
    expect(html).toContain("text-muted-foreground")
    expect(html).not.toContain("text-destructive")
    expect(html).not.toContain("text-amber")
    expect(html).not.toContain("Ripgrep JSON record exceeded 65536 bytes")
    expect(html).not.toContain("这个步骤没有完成")
  })
})
