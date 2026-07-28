import type { AuthAccountSummary } from "../../../electron/auth/common.ts"

export interface UserIdentityLabels {
  displayName: string
  email: string
  uid: string
  username: string
}

export function formatUserIdentity(account: AuthAccountSummary, labels: UserIdentityLabels): string {
  return [
    `${labels.uid}: ${account.id}`,
    account.email ? `${labels.email}: ${account.email}` : undefined,
    account.username ? `${labels.username}: ${account.username}` : undefined,
    `${labels.displayName}: ${account.name}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}
