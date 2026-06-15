export type ChatErrorKind =
  | "payment_required"
  | "timeout"
  | "connection_interrupted"
  | "rate_limited"
  | "auth_required"
  | "permission_denied"
  | "provider_unavailable"
  | "unknown"

export interface ChatErrorClassification {
  kind: ChatErrorKind
  code?: string
  retryable: boolean
  diagnostics: string
  displayMessage?: string
}

const errorCodePrefix = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/

const paymentRequiredCodes = new Set([
  "CHAT_COMPLETION_PAYMENT_REQUIRED",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_CREDITS",
  "OOMOL_INSUFFICIENT_CREDIT",
  "PAYMENT_REQUIRED",
  "insufficient_balance",
  "insufficient_credits",
  "payment_required",
])

function includesAny(message: string, patterns: string[]): boolean {
  const normalized = message.toLowerCase()
  return patterns.some((pattern) => normalized.includes(pattern))
}

function stripKnownCodePrefix(message: string): { code?: string; message: string } {
  const match = errorCodePrefix.exec(message.trim())
  if (!match) {
    return { message: message.trim() }
  }
  return { code: match[1], message: match[2]?.trim() ?? "" }
}

function readJsonMessage(message: string): { code?: string; status?: number; message?: string } | null {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    const statusValue = typeof parsed["status"] === "string" ? Number(parsed["status"]) : parsed["status"]
    const messageValue = parsed["message"] ?? parsed["error"] ?? parsed["code"]
    return {
      code: typeof parsed["code"] === "string" ? parsed["code"] : undefined,
      status: typeof statusValue === "number" && Number.isFinite(statusValue) ? statusValue : undefined,
      message: typeof messageValue === "string" ? messageValue : undefined,
    }
  } catch {
    return null
  }
}

function resolvePaymentRequired(message: string, code?: string): boolean {
  const parsed = readJsonMessage(message)
  if (parsed?.status === 402) {
    return true
  }
  if (code && paymentRequiredCodes.has(code)) {
    return true
  }
  if (parsed?.code && paymentRequiredCodes.has(parsed.code)) {
    return true
  }
  return includesAny([message, parsed?.message ?? ""].join("\n"), [
    "payment required",
    "insufficient balance",
    "insufficient credit",
    "insufficient credits",
    "not enough credits",
    "account is in deficit",
    "oomol_insufficient_credit",
    "余额不足",
    "code 402",
    "http 402",
    "status 402",
  ])
}

function resolvedCode(primaryCode: string | undefined, message: string): string | undefined {
  const parsed = readJsonMessage(message)
  return primaryCode ?? parsed?.code
}

export function normalizeChatError(rawMessage: string): ChatErrorClassification {
  const diagnostics = rawMessage.trim()
  const { code, message } = stripKnownCodePrefix(diagnostics)
  const effectiveMessage = message || diagnostics
  const effectiveCode = resolvedCode(code, effectiveMessage)
  const effectiveStatus = readJsonMessage(effectiveMessage)?.status

  if (resolvePaymentRequired(effectiveMessage, effectiveCode)) {
    return {
      kind: "payment_required",
      code: effectiveCode,
      retryable: false,
      diagnostics,
    }
  }

  if (
    effectiveCode === "CHAT_COMPLETION_TIMEOUT" ||
    includesAny(diagnostics, ["request timeout", "timed out", "timeout"])
  ) {
    return {
      kind: "timeout",
      code: effectiveCode,
      retryable: true,
      diagnostics,
    }
  }

  if (
    effectiveCode === "CHAT_COMPLETION_INTERRUPTED" ||
    includesAny(diagnostics, ["connection interrupted", "websocket reconnection failed", "websocket connection failed"])
  ) {
    return {
      kind: "connection_interrupted",
      code: effectiveCode,
      retryable: true,
      diagnostics,
    }
  }

  if (
    effectiveStatus === 429 ||
    includesAny(diagnostics, ["rate limit", "too many requests", "code 429", "http 429"])
  ) {
    return {
      kind: "rate_limited",
      code: effectiveCode,
      retryable: true,
      diagnostics,
    }
  }

  if (
    effectiveStatus === 401 ||
    includesAny(diagnostics, ["unauthorized", "sign in", "login required", "code 401", "http 401"])
  ) {
    return {
      kind: "auth_required",
      code: effectiveCode,
      retryable: false,
      diagnostics,
    }
  }

  if (
    effectiveStatus === 403 ||
    includesAny(diagnostics, ["permission denied", "forbidden", "access denied", "code 403", "http 403"])
  ) {
    return {
      kind: "permission_denied",
      code: effectiveCode,
      retryable: false,
      diagnostics,
    }
  }

  if (
    (typeof effectiveStatus === "number" && effectiveStatus >= 500) ||
    includesAny(diagnostics, ["service unavailable", "bad gateway", "gateway timeout", "code 500", "http 500"])
  ) {
    return {
      kind: "provider_unavailable",
      code: effectiveCode,
      retryable: true,
      diagnostics,
    }
  }

  return {
    kind: "unknown",
    code: effectiveCode,
    retryable: true,
    diagnostics,
    displayMessage: effectiveMessage || undefined,
  }
}
