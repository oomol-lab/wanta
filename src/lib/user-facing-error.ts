import type { MessageKey, TranslateFn } from "../i18n/i18n.ts"

export type UserFacingErrorSeverity = "info" | "warning" | "destructive"

export type UserFacingErrorArea =
  | "agent"
  | "artifact"
  | "auth"
  | "billing"
  | "chat"
  | "connections"
  | "model"
  | "session"
  | "skills"
  | "update"
  | "voice"
  | "generic"

export type UserFacingErrorKind =
  | "agent_unavailable"
  | "auth_required"
  | "cancelled"
  | "local_file_unavailable"
  | "network_unavailable"
  | "operation_failed"
  | "permission_denied"
  | "rate_limited"
  | "server_unavailable"
  | "timeout"
  | "validation_error"

export interface UserFacingError {
  area: UserFacingErrorArea
  kind: UserFacingErrorKind
  severity: UserFacingErrorSeverity
  titleKey: MessageKey
  descriptionKey: MessageKey
  descriptionText?: string
  diagnostics?: string
}

export interface ResolveUserFacingErrorOptions {
  area?: UserFacingErrorArea
  fallbackTitleKey?: MessageKey
  fallbackDescriptionKey?: MessageKey
  preserveMessage?: boolean
}

const statusPattern = /(?:status|code|http)\s*:?\s*(\d{3})/i

const areaTitleKeys: Record<UserFacingErrorArea, MessageKey> = {
  agent: "error.agent.title",
  artifact: "error.artifact.title",
  auth: "error.auth.title",
  billing: "error.billing.title",
  chat: "error.chat.title",
  connections: "error.connections.title",
  generic: "error.generic.title",
  model: "error.model.title",
  session: "error.session.title",
  skills: "error.skills.title",
  update: "error.update.title",
  voice: "error.voice.title",
}

const areaDescriptionKeys: Record<UserFacingErrorArea, MessageKey> = {
  agent: "error.agent.description",
  artifact: "error.artifact.description",
  auth: "error.auth.description",
  billing: "error.billing.description",
  chat: "error.chat.description",
  connections: "error.connections.description",
  generic: "error.generic.description",
  model: "error.model.description",
  session: "error.session.description",
  skills: "error.skills.description",
  update: "error.update.description",
  voice: "error.voice.description",
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause)
}

export function resolveUserFacingError(
  cause: unknown,
  {
    area = "generic",
    fallbackDescriptionKey,
    fallbackTitleKey,
    preserveMessage = false,
  }: ResolveUserFacingErrorOptions = {},
): UserFacingError {
  if (isUserFacingError(cause)) {
    return cause
  }
  const diagnostics = errorMessage(cause).trim()
  const normalized = diagnostics.toLowerCase()
  const status = readStatusCode(diagnostics)

  if (normalized === "lumo_oauth_pending") {
    return buildError(
      area,
      "timeout",
      "warning",
      "error.connections.oauthPending.title",
      "error.connections.oauthPending.description",
      diagnostics,
    )
  }

  if (normalized === "lumo_oauth_cancelled") {
    return buildError(
      area,
      "cancelled",
      "info",
      "error.connections.oauthCancelled.title",
      "error.connections.oauthCancelled.description",
      diagnostics,
    )
  }

  if (area === "agent" || includesAny(normalized, ["agent not configured", "sidecar failed", "opencode"])) {
    return buildError(
      area,
      "agent_unavailable",
      "destructive",
      "error.agent.title",
      "error.agent.description",
      diagnostics,
    )
  }

  if (isCancelled(normalized)) {
    return buildError(area, "cancelled", "info", "error.cancelled.title", "error.cancelled.description", diagnostics)
  }

  if (status === 401 || includesAny(normalized, ["unauthorized", "sign in", "login required", "fresh sign-in"])) {
    return buildError(
      area,
      "auth_required",
      "info",
      "error.authRequired.title",
      "error.authRequired.description",
      diagnostics,
    )
  }

  if (status === 403 || includesAny(normalized, ["forbidden", "permission denied", "access denied"])) {
    return buildError(
      area,
      "permission_denied",
      "destructive",
      "error.permissionDenied.title",
      "error.permissionDenied.description",
      diagnostics,
    )
  }

  if (status === 429 || includesAny(normalized, ["rate limit", "too many requests"])) {
    return buildError(
      area,
      "rate_limited",
      "warning",
      "error.rateLimited.title",
      "error.rateLimited.description",
      diagnostics,
    )
  }

  if (isTimeout(normalized)) {
    return buildError(area, "timeout", "warning", "error.timeout.title", "error.timeout.description", diagnostics)
  }

  if (area === "artifact" || includesAny(normalized, ["enoent", "no such file", "file unavailable"])) {
    return buildError(
      area,
      "local_file_unavailable",
      "warning",
      "error.localFile.title",
      "error.localFile.description",
      diagnostics,
    )
  }

  if (isValidation(normalized)) {
    return buildError(
      area,
      "validation_error",
      "warning",
      "error.validation.title",
      area === "model" ? "error.model.validationDescription" : "error.validation.description",
      diagnostics,
      preserveMessage,
    )
  }

  if (status && status >= 500) {
    return buildError(
      area,
      "server_unavailable",
      "warning",
      "error.serverUnavailable.title",
      "error.serverUnavailable.description",
      diagnostics,
    )
  }

  if (includesAny(normalized, ["bad gateway", "gateway timeout", "service unavailable"])) {
    return buildError(
      area,
      "server_unavailable",
      "warning",
      "error.serverUnavailable.title",
      "error.serverUnavailable.description",
      diagnostics,
    )
  }

  if (isNetwork(normalized)) {
    return buildError(
      area,
      "network_unavailable",
      "warning",
      "error.networkUnavailable.title",
      "error.networkUnavailable.description",
      diagnostics,
    )
  }

  return buildError(
    area,
    "operation_failed",
    "destructive",
    fallbackTitleKey ?? areaTitleKeys[area],
    fallbackDescriptionKey ?? areaDescriptionKeys[area],
    diagnostics,
    preserveMessage,
  )
}

function isUserFacingError(value: unknown): value is UserFacingError {
  return Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    "severity" in value &&
    "titleKey" in value &&
    "descriptionKey" in value,
  )
}

export function userFacingErrorDescription(error: UserFacingError, t: TranslateFn): string {
  return error.descriptionText ?? t(error.descriptionKey)
}

function buildError(
  area: UserFacingErrorArea,
  kind: UserFacingErrorKind,
  severity: UserFacingErrorSeverity,
  titleKey: MessageKey,
  descriptionKey: MessageKey,
  diagnostics: string,
  preserveMessage = false,
): UserFacingError {
  return {
    area,
    kind,
    severity,
    titleKey,
    descriptionKey,
    descriptionText: preserveMessage && diagnostics ? diagnostics : undefined,
    diagnostics: diagnostics || undefined,
  }
}

function readStatusCode(message: string): number | undefined {
  const jsonStatus = readJsonStatus(message)
  if (jsonStatus) {
    return jsonStatus
  }
  const match = statusPattern.exec(message)
  if (!match) {
    return undefined
  }
  const status = Number(match[1])
  return Number.isFinite(status) ? status : undefined
}

function readJsonStatus(message: string): number | undefined {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>
    const statusValue = parsed["status"] ?? parsed["statusCode"] ?? parsed["code"]
    const status = typeof statusValue === "string" ? Number(statusValue) : statusValue
    return typeof status === "number" && Number.isFinite(status) ? status : undefined
  } catch {
    return undefined
  }
}

function includesAny(message: string, patterns: string[]): boolean {
  return patterns.some((pattern) => message.includes(pattern))
}

function isCancelled(message: string): boolean {
  return includesAny(message, ["aborterror", "aborted", "cancelled", "canceled", "user cancelled"])
}

function isTimeout(message: string): boolean {
  return includesAny(message, ["timeout", "timed out", "still pending"])
}

function isNetwork(message: string): boolean {
  return includesAny(message, [
    "bad gateway",
    "connection interrupted",
    "connection refused",
    "econnrefused",
    "enotfound",
    "fetch failed",
    "gateway timeout",
    "network",
    "socket",
    "websocket",
  ])
}

function isValidation(message: string): boolean {
  return includesAny(message, ["base url is required", "invalid url", "model name is required", "api key is required"])
}
