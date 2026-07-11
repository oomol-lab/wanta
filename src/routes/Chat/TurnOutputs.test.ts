import type { TurnOutputRecord } from "../../../electron/chat/common.ts"
import type { AppContextValue } from "@/components/AppContext"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnOutputsPanel } from "./TurnOutputs.tsx"
import { AppContext } from "@/components/AppContext"
import { I18nContext, translate } from "@/i18n/i18n"

const record: TurnOutputRecord = {
  sessionId: "session-1",
  messageId: "assistant-1",
  projectRoot: "/tmp/project",
  processRoot: "/tmp/process",
  createdAt: 1,
  completedAt: 2,
  files: [
    {
      path: "/tmp/project/src/app.ts",
      name: "app.ts",
      role: "project_change",
      changeKind: "modified",
      mime: "text/typescript",
      additions: 2,
      deletions: 1,
    },
    {
      path: "/tmp/process/create-report.ts",
      name: "create-report.ts",
      role: "process",
      changeKind: "added",
      mime: "text/typescript",
      additions: 8,
      deletions: 0,
    },
  ],
  summary: { additions: 10, changedFileCount: 1, deletions: 1, processFileCount: 1 },
}

function renderPanel(initialRole: "process" | "project_change"): string {
  return renderToStaticMarkup(
    React.createElement(
      AppContext.Provider,
      { value: { chatService: {} } as AppContextValue },
      React.createElement(
        I18nContext.Provider,
        {
          value: {
            locale: "zh-CN",
            setLocale: () => undefined,
            t: (key, vars) => translate("zh-CN", key, vars),
          },
        },
        React.createElement(TurnOutputsPanel, {
          maximized: false,
          onCollapse: () => undefined,
          onToggleMaximized: () => undefined,
          selection: { initialRole, record },
        }),
      ),
    ),
  )
}

describe("TurnOutputsPanel", () => {
  it("renders a shared role switch when project changes and process files both exist", () => {
    const html = renderPanel("project_change")

    expect(html).toContain('role="tablist"')
    expect(html).toContain("变更")
    expect(html).toContain("过程文件")
    expect(html).toContain('role="tab" aria-selected="true"')
    expect(html).toContain("1 个文件变更")
    expect(html).not.toContain("不属于最终制成品；仅在需要检查执行细节时查看")
  })

  it("opens the same panel on process files when execution details were requested", () => {
    const html = renderPanel("process")

    expect(html).toContain("执行详情")
    expect(html).toContain("1 个过程文件")
    expect(html).toContain("不属于最终制成品；仅在需要检查执行细节时查看")
    expect(html).not.toContain("分栏")
    expect(html).not.toContain("统一")
    expect(html).toContain("全部折叠")
  })
})
