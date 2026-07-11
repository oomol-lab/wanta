import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ConnectorAuthorizationIssue } from "./chat-turns.ts"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { I18nContext, translate } from "../../i18n/i18n.ts"
import { ConnectionAuthorizationIssueAction } from "./ChatMessageActions.tsx"

function issue(extra: Partial<ConnectorAuthorizationIssue> = {}): ConnectorAuthorizationIssue {
  return {
    authorization: {
      service: "posthog",
      displayName: "PostHog",
      errorCode: "app_not_found",
    },
    count: 1,
    inconsistent: false,
    key: "posthog\0default",
    service: "posthog",
    ...extra,
  }
}

function provider(): ConnectionProvider {
  return {
    actionKind: "api_key",
    appAuthType: "api_key",
    appCount: 1,
    appId: "app-posthog",
    apps: [],
    appStatus: "active",
    authTypes: ["api_key"],
    canDisconnect: true,
    categoryLabels: [],
    displayName: "PostHog",
    oauthClientConfig: null,
    service: "posthog",
    status: "connected",
  }
}

function renderIssue(value: ConnectorAuthorizationIssue, connectedProvider?: ConnectionProvider): string {
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
      React.createElement(ConnectionAuthorizationIssueAction, {
        issue: value,
        provider: connectedProvider,
        onAuthorize: () => undefined,
      }),
    ),
  )
}

describe("ConnectionAuthorizationIssueAction", () => {
  it("renders one aggregated connect action for repeated failures", () => {
    const html = renderIssue(issue({ count: 6 }))

    expect(html).toContain("同一连接问题共影响了 6 次调用")
    expect(html.match(/在 Wanta 中连接/g)).toHaveLength(1)
  })

  it("uses an uncertainty message after the target already succeeded", () => {
    const html = renderIssue(issue({ inconsistent: true }))

    expect(html).toContain("在本次任务中曾调用成功")
    expect(html).toContain("检查连接")
    expect(html).not.toContain("需要授权 PostHog 才能继续")
  })

  it("does not tell users to connect when the provider catalog still shows active", () => {
    const html = renderIssue(issue(), provider())

    expect(html).toContain("当前显示为已连接")
    expect(html).toContain("检查连接")
    expect(html).not.toContain("在 Wanta 中连接")
  })
})
