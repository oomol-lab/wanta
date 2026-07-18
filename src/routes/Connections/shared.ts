import type { ConnectionAuthType } from "../../../electron/connections/common.ts"
import type { MessageKey, TranslateFn } from "@/i18n/i18n"

export function authTypeLabel(t: TranslateFn, authType: ConnectionAuthType): string {
  return t(`connections.authType.${authType}` as MessageKey)
}
