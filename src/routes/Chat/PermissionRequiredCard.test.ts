import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PermissionRequiredCard } from "./PermissionRequiredCard.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const t: TranslateFn = (key, vars) => translate("zh-CN", key, vars)

function renderPermissionCard(request: ChatPermissionRequest): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      { value: { locale: "zh-CN", setLocale: () => undefined, t } },
      React.createElement(PermissionRequiredCard, {
        request,
        onAllowForSession: () => Promise.resolve(),
        onAllowOnce: () => Promise.resolve(),
        onReject: () => Promise.resolve(),
      }),
    ),
  )
}

describe("PermissionRequiredCard", () => {
  it("does not label an ordinary dependency confirmation as high risk", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "npm install" },
      resources: ["npm install"],
      sessionId: "session-1",
    })

    expect(html).toContain("需要运行本地命令")
    expect(html).not.toContain("需要确认高风险命令")
  })

  it("keeps global package installation in the high-risk presentation", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "npm --global install eslint" },
      resources: ["npm --global install eslint"],
      sessionId: "session-1",
    })

    expect(html).toContain("需要确认高风险命令")
  })

  it("does not offer task-scoped Python approval when the request also accesses sensitive data", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: {
        command: "/tmp/wanta-process/task/.wanta-python/bin/python -m pip install openpyxl",
      },
      resources: ["/Users/me/.ssh/id_ed25519"],
      sessionId: "session-1",
    })

    expect(html).toContain("需要确认私密数据访问")
    expect(html).toContain("允许本次操作")
    expect(html).not.toContain("本次任务允许这些 Python 依赖")
  })
})
