import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ConnectorAuthorizationIssue } from "./chat-turns.ts"

export function connectionAuthorizationIssueDecision(
  issue: ConnectorAuthorizationIssue,
  provider?: ConnectionProvider,
): {
  actionKey: "chat.reviewConnection" | "chat.authorizeConnection"
  displayName: string
  messageKey: "chat.connectionIssueInconsistent" | "chat.connectionIssueConnected" | "chat.authNeeded"
} {
  const providerConnected = provider?.status === "connected" && provider.appStatus === "active"
  const uncertain = issue.inconsistent || providerConnected
  return {
    actionKey: uncertain ? "chat.reviewConnection" : "chat.authorizeConnection",
    displayName: provider?.displayName ?? issue.authorization.displayName,
    messageKey: issue.inconsistent
      ? "chat.connectionIssueInconsistent"
      : providerConnected
        ? "chat.connectionIssueConnected"
        : "chat.authNeeded",
  }
}
