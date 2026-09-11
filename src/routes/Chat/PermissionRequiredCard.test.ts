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

    expect(html).toContain("运行电脑上的一项操作？")
    expect(html).not.toContain("允许执行可能造成较大影响的操作？")
  })

  it("keeps global package installation in the high-risk presentation", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "npm --global install eslint" },
      resources: ["npm --global install eslint"],
      sessionId: "session-1",
    })

    expect(html).toContain("允许执行可能造成较大影响的操作？")
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

    expect(html).toContain("允许访问可能包含私密信息的内容？")
    expect(html).toContain("允许这次访问")
    expect(html).not.toContain("在本次任务中允许安装这些工具")
  })

  it("explains protected Python dependency operations as scope boundaries", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "pipx install black" },
      resources: ["pipx install black"],
      sessionId: "session-1",
    })

    expect(html).toContain("允许更改已安装的工具？")
    expect(html).toContain("核对工具来源和安装范围")
  })

  it("explains broad local access instead of presenting a generic path prompt", () => {
    const html = renderPermissionCard({
      action: "external_directory",
      id: "permission-1",
      resources: ["/Users/me"],
      sessionId: "session-1",
      wanta: { promptReason: "broad_resource" },
    })

    expect(html).toContain("允许访问更大范围的文件？")
    expect(html).toContain("可能包含你没有为本次任务选择的文件")
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

    expect(html).toContain("这一步暂时未能继续")
    expect(html).toContain("未能成功传递这一步的执行许可")
    expect(html).not.toContain("允许执行可能造成较大影响的操作？")
  })

  it("treats selected-project env writes as ordinary edits, not private data", () => {
    const html = renderPermissionCard({
      action: "edit",
      id: "permission-1",
      resources: ["/Users/me/code/app/.env"],
      sessionId: "session-1",
      wanta: { promptReason: "unclassified_request" },
    })

    expect(html).toContain("允许修改这些文件？")
    expect(html).toContain("在这个对话中允许修改此位置的文件")
    expect(html).not.toContain("允许访问可能包含私密信息的内容？")
  })

  it("does not present a selected-project env shell write as high risk", () => {
    const html = renderPermissionCard({
      action: "bash",
      id: "permission-1",
      metadata: { command: "printf 'FOO=1\\n' > /Users/me/code/app/.env" },
      resources: ["printf 'FOO=1\\n' > /Users/me/code/app/.env"],
      sessionId: "session-1",
      wanta: { promptReason: "unclassified_request" },
    })

    expect(html).toContain("运行电脑上的一项操作？")
    expect(html).not.toContain("允许执行可能造成较大影响的操作？")
    expect(html).not.toContain("允许访问可能包含私密信息的内容？")
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

    expect(html).toContain("允许更改已安装的工具？")
    expect(html).toContain("核对工具来源和安装范围")
  })
})
