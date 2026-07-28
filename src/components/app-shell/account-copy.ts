import type { AuthAccountSummary } from "../../../electron/auth/common.ts"

export function formatUserIdentity(account: AuthAccountSummary): string {
  return [
    `UID: ${account.id}`,
    account.email ? `Email: ${account.email}` : undefined,
    account.username ? `Username: ${account.username}` : undefined,
    `Display Name: ${account.name}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}
