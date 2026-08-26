import type { ChatMessage } from "../../chat/common.ts"
import type { AgentEvent } from "../contract/event.ts"

import { isSensitiveConnectorKey, redactConnectorOutput } from "../oo-guard-core.ts"

const embeddedJsonStringField = /("([A-Za-z][A-Za-z0-9_-]*)"\s*:\s*)"(?:\\.|[^"\\])*"/gu
const embeddedEscapedJsonStringField = /(\\+"([A-Za-z][A-Za-z0-9_-]*)\\+"\s*:\s*)\\+"[^"\\]*\\+"/gu
const sensitiveTextHint =
  /(?:access[_-]?token|api[_-]?(?:key|token)|authorization|bearer\s|client[_-]?secret|cookie|credential|password|personal[_-]?api[_-]?key|refresh[_-]?token|secret[_-]?api[_-]?token)/iu
const bearerToken = /(\bbearer\s+)[^\s,;]+/giu

declare const redactedExternalAgentEvent: unique symbol
export type RedactedExternalAgentEvent = AgentEvent & { readonly [redactedExternalAgentEvent]: true }

function redactTranscriptString(value: string): string {
  if (!sensitiveTextHint.test(value)) return value
  return redactConnectorOutput(value.replace(bearerToken, "$1[redacted]"))
    .replace(embeddedJsonStringField, (match, prefix: string, key: string) =>
      isSensitiveConnectorKey(key) ? `${prefix}"[redacted]"` : match,
    )
    .replace(embeddedEscapedJsonStringField, (match, prefix: string, key: string) =>
      isSensitiveConnectorKey(key) ? `${prefix}\\"[redacted]\\"` : match,
    )
}

/**
 * Final credential boundary for external-agent transcripts. Native runtimes
 * can bypass a PATH shim or return provider-shaped objects through another
 * tool, so persistence and UI history must never assume an upstream transport
 * already redacted the payload.
 */
export function redactExternalTranscriptValue<T>(value: T): T {
  if (typeof value === "string") return redactTranscriptString(value) as T
  if (Array.isArray(value)) return value.map((item) => redactExternalTranscriptValue(item)) as T
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveConnectorKey(key) ? "[redacted]" : redactExternalTranscriptValue(item),
    ]),
  ) as T
}

export function redactExternalAgentEvent(event: AgentEvent): RedactedExternalAgentEvent {
  return redactExternalTranscriptValue(event) as RedactedExternalAgentEvent
}

export function redactExternalMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return redactExternalTranscriptValue([...messages])
}
