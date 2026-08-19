import type { ToolFailureKind, ToolUserImpact } from "../chat/common.ts"

export interface ClassifiedToolFailure {
  failureKind: ToolFailureKind
  userImpact?: ToolUserImpact
}

/** Conservative, redaction-safe classification of native tool error text. */
export function classifyToolFailure(message: string): ClassifiedToolFailure {
  const normalized = message.toLowerCase()
  if (
    normalized.includes("parse error") ||
    normalized.includes("invalid json") ||
    normalized.includes("json parse") ||
    normalized.includes("schema mismatch") ||
    normalized.includes("unknown option") ||
    normalized.includes("invalid input")
  ) {
    return { failureKind: "input", userImpact: "none" }
  }
  if (
    normalized.includes("network-restricted sandbox") ||
    normalized.includes("outside the sandbox") ||
    normalized.includes("sandbox violation")
  ) {
    return { failureKind: "sandbox", userImpact: "none" }
  }
  if (
    normalized.includes("authorization") ||
    normalized.includes("authentication") ||
    normalized.includes("permission denied") ||
    normalized.includes("scope_missing") ||
    normalized.includes("credential_expired") ||
    normalized.includes("app_not_found")
  ) {
    return { failureKind: "authorization" }
  }
  if (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("dns") ||
    normalized.includes("unable to connect") ||
    normalized.includes("network")
  ) {
    return { failureKind: "network" }
  }
  if (
    normalized.includes("acp connection") ||
    normalized.includes("agent runtime") ||
    normalized.includes("exited unexpectedly") ||
    normalized.includes("connection closed")
  ) {
    return { failureKind: "agent_runtime" }
  }
  if (/\bhttp\s+[45]\d\d\b/u.test(normalized) || normalized.includes("provider_error")) {
    return { failureKind: "provider" }
  }
  return { failureKind: "unknown" }
}
