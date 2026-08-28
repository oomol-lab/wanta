import type { MessageKey } from "../i18n/i18n.ts"
import type { UserFacingError } from "./user-facing-error.ts"

import { errorMessage, resolveUserFacingError } from "./user-facing-error.ts"

export type ConnectionErrorOperation =
  | "connect"
  | "detail"
  | "disconnect"
  | "reconnect"
  | "set_default"
  | "summary"
  | "update_alias"

const permissionTitleKeys: Record<ConnectionErrorOperation, MessageKey> = {
  connect: "error.connections.permissionConnect.title",
  detail: "error.connections.permissionDetail.title",
  disconnect: "error.connections.permissionDisconnect.title",
  reconnect: "error.connections.permissionReconnect.title",
  set_default: "error.connections.permissionSetDefault.title",
  summary: "error.connections.permissionSummary.title",
  update_alias: "error.connections.permissionUpdateAlias.title",
}

const operationTitleKeys: Record<ConnectionErrorOperation, MessageKey> = {
  connect: "error.connections.connectFailed.title",
  detail: "error.connections.detailFailed.title",
  disconnect: "error.connections.disconnectFailed.title",
  reconnect: "error.connections.reconnectFailed.title",
  set_default: "error.connections.setDefaultFailed.title",
  summary: "error.connections.title",
  update_alias: "error.connections.updateAliasFailed.title",
}

export function resolveConnectionError(cause: unknown, operation: ConnectionErrorOperation): UserFacingError {
  const message = errorMessage(cause).toLowerCase()
  if (message.includes("oauth_client_config_required") || message.includes("oauth client config is required")) {
    return {
      area: "connections",
      kind: "validation_error",
      severity: "warning",
      titleKey: "error.connections.oauthClientConfigRequired.title",
      descriptionKey: "error.connections.oauthClientConfigRequired.description",
      diagnostics: errorMessage(cause),
    }
  }

  const error = resolveUserFacingError(cause, { area: "connections" })

  if (error.kind === "permission_denied") {
    return {
      ...error,
      severity: "warning",
      titleKey: permissionTitleKeys[operation],
      descriptionKey: "error.connections.permissionDenied.description",
    }
  }

  if (error.kind === "operation_failed") {
    return {
      ...error,
      titleKey: operationTitleKeys[operation],
    }
  }

  return error
}
