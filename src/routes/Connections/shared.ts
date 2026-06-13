import type { ConnectionAuthType } from "../../../electron/connections/common.ts"
import type { MessageKey, TranslateFn } from "@/i18n/i18n"

/** 连接优先级：oauth > no_auth > api_key > custom > federated。 */
export function pickAuthType(authTypes: ConnectionAuthType[]): ConnectionAuthType | null {
  for (const preferred of ["oauth2", "no_auth", "api_key", "custom_credential", "federated"] as const) {
    if (authTypes.includes(preferred)) {
      return preferred
    }
  }
  return authTypes[0] ?? null
}

export function authTypeLabel(t: TranslateFn, authType: ConnectionAuthType): string {
  return t(`connections.authType.${authType}` as MessageKey)
}

export function formatTimestamp(value?: number): string {
  if (!value) {
    return "—"
  }
  return new Date(value).toLocaleString()
}
