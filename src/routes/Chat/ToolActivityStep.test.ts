import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { I18nContext, translate } from "../../i18n/i18n.ts"
import { ToolActivityStep } from "./ToolActivityStep.tsx"
import { groupedToolActivityParts, groupedWikigraphToolActivityBlocks } from "./wikigraph-tool-grouping.ts"

function renderToolActivityStep(
  part: ChatMessagePart,
  options: {
    live?: boolean
    recovered?: boolean
    shimmer?: boolean
    settling?: boolean
    showAuthorizationPrompt?: boolean
  } = {},
): string {
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
      React.createElement(ToolActivityStep, {
        part,
        live: options.live,
        recovered: options.recovered,
        shimmer: options.shimmer,
        settling: options.settling,
        showAuthorizationPrompt: options.showAuthorizationPrompt,
        onAuthorize: () => undefined,
      }),
    ),
  )
}

it("presents a safe failed attempt as automatically handled when the turn recovered", () => {
  const html = renderToolActivityStep(
    {
      kind: "tool",
      partId: "tool-failed",
      callId: "call-failed",
      tool: "execute",
      status: "error",
      error: "zsh: parse error near ')'",
      failureKind: "input",
      userImpact: "none",
    },
    { recovered: true },
  )

  expect(html).toContain("已自动处理")
  expect(html).not.toContain("未完成")
  expect(html).not.toContain("lucide-circle-alert")
})

function shimmerClassFor(html: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = html.match(new RegExp(`class="([^"]*text-transparent[^"]*)"[^>]*>${escaped}</span>`))
  if (!match?.[1]) {
    throw new Error(`Missing shimmer span for ${text}.`)
  }
  return match[1]
}

function assistantMessage(id: string): ChatMessage {
  return { id, role: "assistant", parts: [], createdAt: 1 }
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
    expect(html).toMatch(/<code class="[^"]*w-0[^"]*max-w-full[^"]*truncate[^"]*"/)
    expect(html).toContain("w-full max-w-full min-w-0 flex-1 items-center gap-2 overflow-hidden")
    expect(html).not.toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>[^<]*curl/)
  })

  it("keeps a long completed command within the tool row width", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-long-command",
      callId: "call-long-command",
      tool: "bash",
      status: "completed",
      input: {
        command:
          'python3 -m venv "/Users/example/Library/Application Support/wanta/agent/process/session/.wanta-python" && "/Users/example/Library/Application Support/wanta/agent/process/session/.wanta-python/bin/python" -m pip install openpyxl reportlab',
      },
    })

    expect(html).toMatch(/<code class="[^"]*w-0[^"]*max-w-full[^"]*truncate[^"]*"/)
    expect(html).toContain("group/tool-step flex min-h-6 w-full max-w-full min-w-0 flex-1")
    expect(html).toContain("w-full max-w-full min-w-0 overflow-hidden rounded-md")
  })

  it("renders WG Bash knowledge calls without command details or an expand affordance", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-wg",
      callId: "call-wg",
      tool: "bash",
      status: "completed",
      input: { command: 'wg wikg://lib --query "唐僧" --json | jq .' },
      output: "{}",
    })

    expect(html).toContain("查询知识库")
    expect(html).toContain("已完成")
    expect(html).not.toContain("正在查询知识库")
    expect(html).not.toContain("opacity-0 group-hover/tool-step:opacity-100")
    expect(html).not.toContain("wg wikg://lib")
    expect(html).not.toContain("jq .")
    expect(html).not.toContain("工具参数")
    expect(html).not.toContain("工具结果")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("renders assignment-prefix WG Bash substitutions as knowledge activity", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-wg-assignment",
      callId: "call-wg-assignment",
      tool: "bash",
      status: "completed",
      input: { command: "env FOO=$(wg wikg://lib/entity --query 唐僧 --json) node -e 1" },
      output: "{}",
    })

    expect(html).toContain("知识库")
    expect(html).not.toContain("env FOO=")
    expect(html).not.toContain("wg wikg://lib")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("keeps quoted assignment WG Bash text visible as an ordinary command", () => {
    const command = "env FOO='$(wg wikg://lib/entity --query 唐僧 --json)' node -e 1"
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-wg-quoted-assignment",
      callId: "call-wg-quoted-assignment",
      tool: "bash",
      status: "completed",
      input: { command },
      output: "{}",
    })

    expect(html).not.toContain("正在查询知识库...")
    expect(html).toContain("env FOO=&#x27;$(wg wikg://lib/entity --query 唐僧 --json)&#x27; node -e 1")
    expect(html).toContain("lucide-chevron-right")
  })

  it("renders consecutive WG Bash knowledge calls as one compact knowledge row", () => {
    const parts = groupedToolActivityParts([
      {
        kind: "tool",
        partId: "tool-wg-1",
        callId: "call-wg-1",
        tool: "bash",
        status: "completed",
        input: { command: 'wg wikg://lib/entity --query "唐僧" --json | jq .' },
        output: "{}",
      },
      {
        kind: "tool",
        partId: "tool-wg-2",
        callId: "call-wg-2",
        tool: "bash",
        status: "completed",
        input: { command: 'wg wikg://lib/evidence --query "孙悟空" --json | jq .' },
        output: "{}",
      },
    ])
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(1)
    expect(html.match(/查询知识库/g)).toHaveLength(1)
    expect(html).toContain("已完成")
    expect(html).not.toContain("wg wikg://lib")
    expect(html).not.toContain("jq .")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("coalesces WikiGraph activity across adjacent tool blocks before rendering", () => {
    const firstMessage = assistantMessage("assistant-1")
    const secondMessage = assistantMessage("assistant-2")
    const blocks = groupedWikigraphToolActivityBlocks([
      {
        message: firstMessage,
        block: {
          kind: "tools",
          key: "tool-skill",
          parts: [
            {
              kind: "tool",
              partId: "tool-skill",
              callId: "call-skill",
              tool: "skill",
              status: "completed",
              title: "Loaded skill: wikigraph-knowledge",
            },
            {
              kind: "tool",
              partId: "tool-wg-help",
              callId: "call-wg-help",
              tool: "bash",
              status: "completed",
              input: { command: "wg help recipe 2>&1" },
              output: "Usage: wg ...",
            },
          ],
        },
      },
      {
        message: secondMessage,
        block: {
          kind: "tools",
          key: "tool-wg-1",
          parts: [
            {
              kind: "tool",
              partId: "tool-wg-1",
              callId: "call-wg-1",
              tool: "bash",
              status: "completed",
              input: { command: 'wg wikg://lib/search --query "华容道" --json' },
            },
            {
              kind: "tool",
              partId: "tool-wg-2",
              callId: "call-wg-2",
              tool: "bash",
              status: "running",
              input: { command: 'wg wikg://lib/evidence --query "关羽 曹操" --json' },
            },
          ],
        },
      },
    ])
    const html = blocks
      .flatMap(({ block }) => (block.kind === "tools" ? block.parts : []))
      .map((part) => renderToolActivityStep(part))
      .join("\n")

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.block.kind).toBe("tools")
    expect(blocks[0]?.block.kind === "tools" ? blocks[0].block.parts : []).toHaveLength(1)
    expect(html.match(/查询知识库/g)).toHaveLength(1)
    expect(html).toContain("运行中")
    expect(html).not.toContain("wg help recipe")
    expect(html).not.toContain("wg wikg://")
    expect(html).not.toContain("wikigraph-knowledge")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("hides unsettled unknown Bash commands while a WikiGraph activity lock is active", () => {
    const message = assistantMessage("assistant-1")
    const blocks = groupedWikigraphToolActivityBlocks([
      {
        message,
        block: {
          kind: "tools",
          key: "tool-wg",
          parts: [
            {
              kind: "tool",
              partId: "tool-wg",
              callId: "call-wg",
              tool: "bash",
              status: "completed",
              input: { command: 'wg wikg://lib/search --query "华容道" --json' },
            },
          ],
        },
      },
      {
        message,
        block: {
          kind: "tools",
          key: "tool-pending",
          parts: [
            {
              kind: "tool",
              partId: "tool-pending",
              callId: "call-pending",
              tool: "bash",
              status: "pending",
              input: {},
            },
          ],
        },
      },
    ])
    const parts = blocks.flatMap(({ block }) => (block.kind === "tools" ? block.parts : []))
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(1)
    expect(html.match(/查询知识库/g)).toHaveLength(1)
    expect(html).not.toContain("运行命令")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("hides unsettled WG Bash commands before they can be classified as knowledge activity", () => {
    const message = assistantMessage("assistant-1")
    const blocks = groupedWikigraphToolActivityBlocks([
      {
        message,
        block: {
          kind: "tools",
          key: "tool-wg-pending",
          parts: [
            {
              kind: "tool",
              partId: "tool-wg-pending",
              callId: "call-wg-pending",
              tool: "bash",
              status: "running",
              input: { command: "wg" },
            },
          ],
        },
      },
    ])
    const parts = blocks.flatMap(({ block }) => (block.kind === "tools" ? block.parts : []))
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(0)
    expect(html).not.toContain("运行命令")
    expect(html).not.toContain("wg")
  })

  it("keeps the trailing WikiGraph activity running while the process is live", () => {
    const message = assistantMessage("assistant-1")
    const sourceBlocks = [
      {
        message,
        block: {
          kind: "tools" as const,
          key: "tool-wg",
          parts: [
            {
              kind: "tool" as const,
              partId: "tool-wg",
              callId: "call-wg",
              tool: "bash",
              status: "completed" as const,
              input: { command: 'wg wikg://lib/search --query "华容道" --json' },
            },
          ],
        },
      },
    ]
    const liveParts = groupedWikigraphToolActivityBlocks(sourceBlocks, { live: true }).flatMap(({ block }) =>
      block.kind === "tools" ? block.parts : [],
    )
    const settledParts = groupedWikigraphToolActivityBlocks(sourceBlocks, { live: false }).flatMap(({ block }) =>
      block.kind === "tools" ? block.parts : [],
    )

    expect(liveParts[0]?.status).toBe("running")
    expect(renderToolActivityStep(liveParts[0]!, { live: true })).toContain("运行中")
    expect(settledParts[0]?.status).toBe("completed")
    expect(renderToolActivityStep(settledParts[0]!, { live: false })).toContain("已完成")
  })

  it("completes a WikiGraph activity once assistant text appears after it", () => {
    const message = assistantMessage("assistant-1")
    const blocks = groupedWikigraphToolActivityBlocks(
      [
        {
          message,
          block: {
            kind: "tools",
            key: "tool-wg",
            parts: [
              {
                kind: "tool",
                partId: "tool-wg",
                callId: "call-wg",
                tool: "bash",
                status: "completed",
                input: { command: 'wg wikg://lib/search --query "华容道" --json' },
              },
            ],
          },
        },
        {
          message,
          block: {
            kind: "text",
            part: { kind: "text", partId: "text-1", text: "我会继续整理结果。" },
          },
        },
      ],
      { live: true },
    )
    const firstBlock = blocks[0]?.block
    const parts = firstBlock?.kind === "tools" ? firstBlock.parts : []

    expect(parts[0]?.status).toBe("completed")
    expect(renderToolActivityStep(parts[0]!, { live: true })).toContain("已完成")
  })

  it("shows a settled non-WG Bash command and exits the WikiGraph activity lock", () => {
    const message = assistantMessage("assistant-1")
    const blocks = groupedWikigraphToolActivityBlocks([
      {
        message,
        block: {
          kind: "tools",
          key: "tool-wg",
          parts: [
            {
              kind: "tool",
              partId: "tool-wg",
              callId: "call-wg",
              tool: "bash",
              status: "completed",
              input: { command: 'wg wikg://lib/search --query "华容道" --json' },
            },
          ],
        },
      },
      {
        message,
        block: {
          kind: "tools",
          key: "tool-echo",
          parts: [
            {
              kind: "tool",
              partId: "tool-echo",
              callId: "call-echo",
              tool: "bash",
              status: "completed",
              input: { command: "echo ok" },
            },
            {
              kind: "tool",
              partId: "tool-wg-next",
              callId: "call-wg-next",
              tool: "bash",
              status: "completed",
              input: { command: 'wg wikg://lib/evidence --query "曹操" --json' },
            },
          ],
        },
      },
    ])
    const parts = blocks.flatMap(({ block }) => (block.kind === "tools" ? block.parts : []))
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(3)
    expect(html.match(/查询知识库/g)).toHaveLength(2)
    expect(html).toContain("echo ok")
    expect(html).toContain("lucide-chevron-right")
  })

  it("preserves adjacent ordinary tool blocks when no WikiGraph grouping changes", () => {
    const firstMessage = assistantMessage("assistant-1")
    const secondMessage = assistantMessage("assistant-2")
    const blocks = [
      {
        message: firstMessage,
        block: {
          kind: "tools" as const,
          key: "tool-ls",
          parts: [
            {
              kind: "tool" as const,
              partId: "tool-ls",
              callId: "call-ls",
              tool: "bash",
              status: "completed" as const,
              input: { command: "ls" },
            },
          ],
        },
      },
      {
        message: secondMessage,
        block: {
          kind: "tools" as const,
          key: "tool-echo",
          parts: [
            {
              kind: "tool" as const,
              partId: "tool-echo",
              callId: "call-echo",
              tool: "bash",
              status: "completed" as const,
              input: { command: "echo ok" },
            },
          ],
        },
      },
    ]

    expect(groupedWikigraphToolActivityBlocks(blocks)).toEqual(blocks)
  })

  it("coalesces WikiGraph skill loads with WG Bash calls in both orders", () => {
    const skillPart: ChatMessagePart = {
      kind: "tool",
      partId: "tool-skill",
      callId: "call-skill",
      tool: "skill",
      status: "completed",
      title: "Loaded skill: wikigraph-knowledge",
      output: "# WikiGraph Knowledge",
    }
    const wgPart: ChatMessagePart = {
      kind: "tool",
      partId: "tool-wg",
      callId: "call-wg",
      tool: "bash",
      status: "completed",
      input: { command: 'wg wikg://lib/search --query "唐僧" --json' },
      output: "{}",
    }

    for (const order of [
      [skillPart, wgPart],
      [wgPart, skillPart],
      [skillPart, { ...skillPart, partId: "tool-skill-2", callId: "call-skill-2" }],
    ]) {
      const parts = groupedToolActivityParts(order)
      const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

      expect(parts).toHaveLength(1)
      expect(html.match(/查询知识库/g)).toHaveLength(1)
      expect(html).toContain("已完成")
      expect(html).not.toContain("wikigraph-knowledge")
      expect(html).not.toContain("Loaded skill")
      expect(html).not.toContain("wg wikg://lib")
      expect(html).not.toContain("工具参数")
      expect(html).not.toContain("工具结果")
      expect(html).not.toContain("lucide-chevron-right")
    }
  })

  it("coalesces an entire WikiGraph flow across skill load, WG probe, completed queries, and a running query", () => {
    for (const probeCommand of ["wg --help 2>&1", 'bash -lc "wg --help 2>&1"', "sh -c 'wikigraph --version 2>&1'"]) {
      const parts = groupedToolActivityParts([
        {
          kind: "tool",
          partId: "tool-skill",
          callId: "call-skill",
          tool: "skill",
          status: "completed",
          title: "Loaded skill: wikigraph-knowledge",
          output: "# WikiGraph Knowledge",
        },
        {
          kind: "tool",
          partId: "tool-wg-help",
          callId: "call-wg-help",
          tool: "bash",
          status: "completed",
          input: { command: probeCommand },
          output: "Usage: wg ...",
        },
        {
          kind: "tool",
          partId: "tool-wg-1",
          callId: "call-wg-1",
          tool: "bash",
          status: "completed",
          input: { command: 'wg wikg://lib/search --query "华容道" --json' },
          output: "{}",
        },
        {
          kind: "tool",
          partId: "tool-wg-2",
          callId: "call-wg-2",
          tool: "bash",
          status: "running",
          input: { command: 'wg wikg://lib/evidence --query "关羽 曹操" --json' },
        },
      ])
      const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

      expect(parts).toHaveLength(1)
      expect(html.match(/查询知识库/g)).toHaveLength(1)
      expect(html).toContain("运行中")
      expect(html).not.toContain("已完成")
      expect(html).not.toContain("wg --help")
      expect(html).not.toContain("wikigraph --version")
      expect(html).not.toContain("wg wikg://")
      expect(html).not.toContain("Loaded skill")
      expect(html).not.toContain("wikigraph-knowledge")
      expect(html).not.toContain("工具参数")
      expect(html).not.toContain("工具结果")
      expect(html).not.toContain("lucide-chevron-right")
    }
  })

  it("keeps WikiGraph probe commands visible when no knowledge flow surrounds them", () => {
    const parts = groupedToolActivityParts([
      {
        kind: "tool",
        partId: "tool-wg-help",
        callId: "call-wg-help",
        tool: "bash",
        status: "completed",
        input: { command: "wg --help 2>&1" },
        output: "Usage: wg ...",
      },
      {
        kind: "tool",
        partId: "tool-ordinary",
        callId: "call-ordinary",
        tool: "bash",
        status: "completed",
        input: { command: "echo ok" },
        output: "ok",
      },
    ])
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(2)
    expect(html).not.toContain("查询知识库")
    expect(html).toContain("wg --help 2&gt;&amp;1")
    expect(html).toContain("echo ok")
  })

  it("keeps ordinary tools as boundaries between knowledge groups", () => {
    const parts = groupedToolActivityParts([
      {
        kind: "tool",
        partId: "tool-wg-1",
        callId: "call-wg-1",
        tool: "bash",
        status: "completed",
        input: { command: 'wg wikg://lib/search --query "唐僧" --json' },
      },
      {
        kind: "tool",
        partId: "tool-jq",
        callId: "call-jq",
        tool: "bash",
        status: "completed",
        input: { command: "jq . /tmp/result.json" },
      },
      {
        kind: "tool",
        partId: "tool-wg-2",
        callId: "call-wg-2",
        tool: "bash",
        status: "completed",
        input: { command: 'wg wikg://lib/evidence --query "孙悟空" --json' },
      },
    ])
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(3)
    expect(html.match(/查询知识库/g)).toHaveLength(2)
    expect(html).toContain("jq . /tmp/result.json")
  })

  it("keeps the merged knowledge row in the failed state", () => {
    const parts = groupedToolActivityParts([
      {
        kind: "tool",
        partId: "tool-skill",
        callId: "call-skill",
        tool: "skill",
        status: "completed",
        title: "Loaded skill: wikigraph-knowledge",
      },
      {
        kind: "tool",
        partId: "tool-wg-failed",
        callId: "call-wg-failed",
        tool: "bash",
        status: "error",
        input: { command: 'wg wikg://lib/entity --query "猪八戒" --json' },
        error: "exit code 1",
      },
    ])
    const html = parts.map((part) => renderToolActivityStep(part)).join("\n")

    expect(parts).toHaveLength(1)
    expect(html).toContain("查询知识库")
    expect(html).toContain("未完成")
    expect(html).not.toContain("wg wikg://lib/entity")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("keeps ordinary skill loads visible and expandable", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-skill",
      callId: "call-skill",
      tool: "skill",
      status: "completed",
      title: "Loaded skill: pdf",
      output: "# PDF",
    })

    expect(html).not.toContain("查询知识库")
    expect(html).toContain("Loaded skill: pdf")
    expect(html).toContain("lucide-chevron-right")
  })

  it("keeps the failed WG Bash status while hiding command details", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-wg-failed",
      callId: "call-wg-failed",
      tool: "bash",
      status: "error",
      input: { command: 'wg wikg://lib/entity --query "唐僧" --json | jq .' },
      error: "exit code 1",
    })

    expect(html).toContain("查询知识库")
    expect(html).toContain("未完成")
    expect(html).not.toContain("wg wikg://lib")
    expect(html).not.toContain("jq .")
    expect(html).not.toContain("lucide-chevron-right")
  })

  it("uses the live status and shimmer instead of loading punctuation for active knowledge queries", () => {
    const html = renderToolActivityStep({
      kind: "tool",
      partId: "tool-wg-running",
      callId: "call-wg-running",
      tool: "bash",
      status: "running",
      input: { command: 'wg wikg://lib/search --query "唐僧" --json' },
    })

    expect(html).toContain("查询知识库")
    expect(html).toContain("运行中")
    expect(html).toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>查询知识库<\/span>/)
    expect(html).not.toContain("查询知识库...")
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

  it("can hide authorization prompts while the turn is still live", () => {
    const part: ChatMessagePart = {
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "call_action",
      status: "completed",
      input: { service: "gmail", action: "fetch_emails" },
      output: JSON.stringify({
        status: "authorization_required",
        service: "gmail",
        displayName: "Gmail",
        errorCode: "connection_required",
      }),
    }

    expect(renderToolActivityStep(part)).toContain("需要授权 Gmail 才能继续")
    expect(renderToolActivityStep(part, { showAuthorizationPrompt: false })).not.toContain("需要授权 Gmail 才能继续")
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

  it("does not shimmer a non-live active question row", () => {
    const html = renderToolActivityStep(
      {
        kind: "tool",
        partId: "question-tool",
        callId: "call-1",
        tool: "question",
        status: "running",
        input: {
          questions: [{ header: "文章标题", question: "你希望这篇测试文章的标题叫什么？", options: [] }],
        },
      },
      { live: false },
    )

    expect(html).toContain("询问信息")
    expect(html).toContain("文章标题")
    expect(html).toContain("已停止")
    expect(html).not.toContain("等待回答")
    expect(html).not.toContain("text-transparent")
  })

  it("uses a finalizing status for a completed tool row while the turn is still transitioning", () => {
    const html = renderToolActivityStep(
      {
        kind: "tool",
        partId: "tool-1",
        callId: "call-1",
        tool: "todo_write",
        status: "completed",
        input: {},
        title: "4 todos",
      },
      { shimmer: true, settling: true },
    )

    expect(html).toMatch(/class="[^"]*text-transparent[^"]*"[^>]*>使用工具<\/span>/)
    expect(html).toContain("4 todos")
    expect(html).toContain("正在整理")
    expect(html).not.toContain("已完成")
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
