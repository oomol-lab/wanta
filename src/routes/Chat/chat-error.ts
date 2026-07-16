import type { ChatErrorClassification, ChatErrorKind } from "../../../electron/chat/error.ts"
import type { MessageKey } from "@/i18n/i18n"

import { normalizeChatError } from "../../../electron/chat/error.ts"

export type { ChatErrorKind } from "../../../electron/chat/error.ts"

export type ChatErrorSeverity = "warning" | "destructive" | "info"
export type ChatErrorRecoveryKind = "current_task" | "fresh_task" | "reauthenticate" | "billing"

export interface ChatErrorViewModel {
  kind: ChatErrorKind
  severity: ChatErrorSeverity
  titleKey: MessageKey
  descriptionKey: MessageKey
  descriptionText?: string
  primaryActionKey?: MessageKey
  secondaryActionKey?: MessageKey
  retryable: boolean
  diagnostics: string
}

export interface ResolveChatErrorOptions {
  errorKind?: ChatErrorKind
  errorCode?: string
}

export function chatErrorRecoveryKind(kind: ChatErrorKind): ChatErrorRecoveryKind | null {
  switch (kind) {
    case "payment_required":
      return "billing"
    case "content_filtered":
      return "fresh_task"
    case "auth_required":
    case "permission_denied":
      return "reauthenticate"
    case "timeout":
    case "connection_interrupted":
    case "rate_limited":
    case "provider_unavailable":
    case "unknown":
      return "current_task"
  }
}

function classification(rawMessage: string, options: ResolveChatErrorOptions = {}): ChatErrorClassification {
  const normalized = normalizeChatError(rawMessage)
  return {
    ...normalized,
    ...(options.errorKind ? { kind: options.errorKind } : {}),
    ...(options.errorCode ? { code: options.errorCode } : {}),
  }
}

export function resolveChatError(rawMessage: string, options: ResolveChatErrorOptions = {}): ChatErrorViewModel {
  const normalized = classification(rawMessage, options)
  switch (normalized.kind) {
    case "payment_required":
      return {
        kind: normalized.kind,
        severity: "warning",
        titleKey: "chatError.paymentRequired.title",
        descriptionKey: "chatError.paymentRequired.description",
        primaryActionKey: "chatError.paymentRequired.primaryAction",
        secondaryActionKey: "chatError.paymentRequired.secondaryAction",
        retryable: false,
        diagnostics: normalized.diagnostics,
      }
    case "content_filtered":
      return {
        kind: normalized.kind,
        severity: "warning",
        titleKey: "chatError.contentFiltered.title",
        descriptionKey: "chatError.contentFiltered.description",
        primaryActionKey: "chatError.contentFiltered.primaryAction",
        secondaryActionKey: "chatError.common.copyDiagnostics",
        retryable: false,
        diagnostics: normalized.diagnostics,
      }
    case "timeout":
      return {
        kind: normalized.kind,
        severity: "warning",
        titleKey: "chatError.timeout.title",
        descriptionKey: "chatError.timeout.description",
        primaryActionKey: "chatError.timeout.primaryAction",
        retryable: true,
        diagnostics: normalized.diagnostics,
      }
    case "connection_interrupted":
      return {
        kind: normalized.kind,
        severity: "warning",
        titleKey: "chatError.interrupted.title",
        descriptionKey: "chatError.interrupted.description",
        primaryActionKey: "chatError.interrupted.primaryAction",
        secondaryActionKey: "chatError.common.copyDiagnostics",
        retryable: true,
        diagnostics: normalized.diagnostics,
      }
    case "rate_limited":
      return {
        kind: normalized.kind,
        severity: "warning",
        titleKey: "chatError.rateLimited.title",
        descriptionKey: "chatError.rateLimited.description",
        primaryActionKey: "chatError.rateLimited.primaryAction",
        retryable: true,
        diagnostics: normalized.diagnostics,
      }
    case "auth_required":
      return {
        kind: normalized.kind,
        severity: "info",
        titleKey: "chatError.authRequired.title",
        descriptionKey: "chatError.authRequired.description",
        primaryActionKey: "chatError.authRequired.primaryAction",
        retryable: false,
        diagnostics: normalized.diagnostics,
      }
    case "permission_denied":
      return {
        kind: normalized.kind,
        severity: "destructive",
        titleKey: "chatError.permissionDenied.title",
        descriptionKey: "chatError.permissionDenied.description",
        primaryActionKey: "chatError.permissionDenied.primaryAction",
        secondaryActionKey: "chatError.common.copyDiagnostics",
        retryable: false,
        diagnostics: normalized.diagnostics,
      }
    case "provider_unavailable":
      return {
        kind: normalized.kind,
        severity: "warning",
        titleKey: "chatError.providerUnavailable.title",
        descriptionKey: "chatError.providerUnavailable.description",
        primaryActionKey: "chatError.providerUnavailable.primaryAction",
        secondaryActionKey: "chatError.common.copyDiagnostics",
        retryable: true,
        diagnostics: normalized.diagnostics,
      }
    case "unknown":
      return {
        kind: normalized.kind,
        severity: "destructive",
        titleKey: "chatError.failed.title",
        descriptionKey: "chatError.failed.description",
        primaryActionKey: "chatError.failed.primaryAction",
        secondaryActionKey: "chatError.common.copyDiagnostics",
        retryable: true,
        diagnostics: normalized.diagnostics,
      }
  }
}
