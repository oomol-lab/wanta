import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ConnectorAuthorizationIssue } from "./chat-turns.ts"

import { describe, expect, it } from "vitest"
import { connectionAuthorizationIssueDecision } from "./connection-authorization-issue.ts"

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

describe("ConnectionAuthorizationIssueAction", () => {
  it("chooses one connect action for repeated failures", () => {
    expect(connectionAuthorizationIssueDecision(issue({ count: 6 }))).toMatchObject({
      actionKey: "chat.authorizeConnection",
      messageKey: "chat.authNeeded",
    })
  })

  it("uses an uncertainty message after the target already succeeded", () => {
    expect(connectionAuthorizationIssueDecision(issue({ inconsistent: true }))).toMatchObject({
      actionKey: "chat.reviewConnection",
      messageKey: "chat.connectionIssueInconsistent",
    })
  })

  it("does not tell users to connect when the provider catalog still shows active", () => {
    expect(connectionAuthorizationIssueDecision(issue(), provider())).toMatchObject({
      actionKey: "chat.reviewConnection",
      messageKey: "chat.connectionIssueConnected",
    })
  })
})
