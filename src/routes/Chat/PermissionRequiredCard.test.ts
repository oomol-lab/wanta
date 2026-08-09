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

  it("explains protected Python dependency operations as scope boundaries", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "pipx install black" },
      resources: ["pipx install black"],
      sessionId: "session-1",
    })

    expect(html).toContain("需要安装 Python 依赖")
    expect(html).toContain("目标范围或依赖来源超出了自动批准边界")
  })

  it("explains broad local access instead of presenting a generic path prompt", () => {
    const html = renderPermissionCard({
      action: "external_directory",
      id: "permission-1",
      resources: ["/Users/me"],
      sessionId: "session-1",
      wanta: { promptReason: "broad_resource" },
    })

    expect(html).toContain("需要确认大范围访问")
    expect(html).toContain("可能包含与当前任务无关的文件")
  })

  it("distinguishes an automatic-reply failure from a high-risk operation", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "npm test" },
      resources: ["npm test"],
      sessionId: "session-1",
      wanta: { automaticReplyFailed: true, promptReason: "automatic_reply_failed" },
    })

    expect(html).toContain("自动批准未完成")
    expect(html).toContain("不表示操作本身被判定为高风险")
    expect(html).not.toContain("需要确认高风险命令")
  })

  it("explains an unbounded Node dependency operation as a policy boundary", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "npm install" },
      resources: ["npm install"],
      sessionId: "session-1",
      wanta: { promptReason: "dependency_mutation" },
    })

    expect(html).toContain("需要确认依赖操作")
    expect(html).toContain("目标项目、安装范围或依赖来源不在自动批准边界内")
  })
})
