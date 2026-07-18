import type { TurnOutputRecord } from "../../../electron/chat/common.ts"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { I18nContext, translate } from "../../i18n/i18n.ts"
import { TurnOutputShelf } from "./TurnOutputShelf.tsx"

const projectRoot = "/Users/test/code/wanta"

function changedFile(path: string, additions: number, deletions: number): TurnOutputRecord["files"][number] {
  return {
    path: `${projectRoot}/${path}`,
    name: path.split("/").pop() ?? path,
    role: "project_change",
    changeKind: "modified",
    mime: "text/plain",
    additions,
    deletions,
  }
}

function processFile(path: string): TurnOutputRecord["files"][number] {
  return {
    path,
    name: path.split("/").pop() ?? path,
    role: "process",
    changeKind: "added",
    mime: "text/plain",
    additions: 0,
    deletions: 0,
  }
}

function renderTurnOutputShelf(record: TurnOutputRecord): string {
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
      React.createElement(TurnOutputShelf, {
        record,
        onOpen: () => undefined,
      }),
    ),
  )
}

describe("TurnOutputShelf", () => {
  it("renders a Codex-style project change summary with a file preview", () => {
    const record: TurnOutputRecord = {
      sessionId: "session-1",
      messageId: "assistant-1",
      projectRoot,
      createdAt: 1,
      completedAt: 2,
      files: [
        changedFile("electron/session/common.ts", 1, 1),
        changedFile("electron/session/node.test.ts", 8, 0),
        changedFile("electron/session/node.ts", 4, 2),
        changedFile("src/routes/Chat/TurnOutputShelf.tsx", 9, 3),
        changedFile("src/i18n/app-messages.zh.ts", 1, 0),
      ],
      summary: {
        additions: 23,
        changedFileCount: 5,
        deletions: 6,
        processFileCount: 0,
      },
    }

    const html = renderTurnOutputShelf(record)

    expect(html).toContain("not-prose mt-0 w-full min-w-0")
    expect(html).not.toContain("max-w-[46rem]")
    expect(html).toContain(
      '<button type="button" class="flex w-full min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-3 text-left',
    )
    expect(html).toContain("已编辑 5 个文件")
    expect(html).toContain("审核")
    expect(html).toContain("+23")
    expect(html).toContain("-6")
    expect(html).toContain("electron/session/common.ts")
    expect(html).toContain("electron/session/node.test.ts")
    expect(html).toContain("electron/session/node.ts")
    expect(html).toContain("再显示 2 个文件")
    expect(html).not.toContain("src/routes/Chat/TurnOutputShelf.tsx")
  })

  it("renders process files as secondary execution details rather than final artifacts", () => {
    const record: TurnOutputRecord = {
      sessionId: "session-1",
      messageId: "assistant-1",
      createdAt: 1,
      completedAt: 2,
      files: [processFile("/tmp/process/script.ts")],
      summary: {
        additions: 0,
        changedFileCount: 0,
        deletions: 0,
        processFileCount: 1,
      },
    }

    const html = renderTurnOutputShelf(record)

    expect(html).toContain('class="not-prose mt-0 min-w-0"')
    expect(html).toContain(
      'class="oo-border-divider flex min-h-16 w-full min-w-0 items-center gap-3 rounded-lg border bg-muted/55',
    )
    expect(html).toContain("执行详情")
    expect(html).toContain("1 个过程文件 · 不属于最终制成品")
    expect(html).not.toContain("审核")
  })

  it("surfaces an incomplete project change scan even when no file diff was captured", () => {
    const record: TurnOutputRecord = {
      sessionId: "session-1",
      messageId: "assistant-1",
      projectRoot,
      projectChangesTruncated: true,
      createdAt: 1,
      completedAt: 2,
      files: [],
      summary: {
        additions: 0,
        changedFileCount: 0,
        deletions: 0,
        processFileCount: 0,
      },
    }

    const html = renderTurnOutputShelf(record)

    expect(html).toContain("项目变更扫描达到安全限制，当前列表可能不完整。")
    expect(html).toContain("审核")
  })
})
