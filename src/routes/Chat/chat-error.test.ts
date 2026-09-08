import { describe, expect, it } from "vitest"
import { chatErrorRecoveryKind, resolveChatError } from "./chat-error.ts"

describe("resolveChatError", () => {
  it.each([
    ["CREDENTIAL_REFERENCE", "credentials"],
    ["ENVIRONMENT_DUMP", "environment"],
    ["RUNTIME_ENVIRONMENT_OVERRIDE", "runtimeEnvironment"],
    ["RUNTIME_AUTH_MUTATION", "runtimeAuth"],
    ["RUNTIME_OPTION_OVERRIDE", "runtimeOptions"],
    ["DIAGNOSTIC_CAPABILITY", "diagnosticCapability"],
    ["DIAGNOSTIC_SCOPE", "diagnosticScope"],
  ] as const)("shows the %s policy reason without parsing tool output", (code, key) => {
    const view = resolveChatError(`CHAT_TOOL_POLICY_BLOCKED_${code}: host policy rejection`)
    expect(view.kind).toBe("tool_blocked")
    expect(view.descriptionKey).toBe(`chatError.toolBlocked.${key}`)
    expect(view.primaryActionKey).toBeUndefined()
    expect(
      resolveChatError("persisted display text", {
        errorKind: "tool_blocked",
        errorCode: `CHAT_TOOL_POLICY_BLOCKED_${code}`,
      }).descriptionKey,
    ).toBe(view.descriptionKey)
  })

  it("keeps the fallback for legacy rejections and a distinct title for user rejection", () => {
    expect(resolveChatError("CHAT_TOOL_POLICY_BLOCKED: unknown rule").descriptionKey).toBe(
      "chatError.toolBlocked.description",
    )
    expect(resolveChatError("CHAT_TOOL_USER_DECLINED: declined").titleKey).toBe("chatError.toolDeclined.title")
    expect(resolveChatError("The tool printed (environment_dump)").kind).toBe("unknown")
  })
  it.each([
    ["CHAT_TOOL_POLICY_BLOCKED", "tool_blocked"],
    ["CHAT_TOOL_USER_DECLINED", "tool_blocked"],
    ["CHAT_RESPONSE_INCOMPLETE", "response_incomplete"],
    ["CHAT_HISTORY_UNAVAILABLE", "history_unavailable"],
  ] as const)("%s does not suggest signing in or replaying completed work", (code, kind) => {
    const view = resolveChatError(`${code}: operation state`)
    expect(view.kind).toBe(kind)
    expect(view.retryable).toBe(false)
    expect(view.primaryActionKey).toBeUndefined()
    expect(view.secondaryActionKey).toBe("chatError.common.copyDiagnostics")
    expect(chatErrorRecoveryKind(kind)).toBeNull()
  })
  it("maps OOMOL insufficient credit errors to payment_required", () => {
    expect(resolveChatError("Payment Required: account is in deficit, code: OOMOL_INSUFFICIENT_CREDIT").kind).toBe(
      "payment_required",
    )
  })

  it("maps 402 and insufficient-credit variants to payment_required", () => {
    expect(resolveChatError("HTTP 402 insufficient credits").kind).toBe("payment_required")
    expect(resolveChatError('PAYMENT_REQUIRED: {"message":"not enough credits","status":"402"}').kind).toBe(
      "payment_required",
    )
    expect(resolveChatError("CHAT_COMPLETION_PAYMENT_REQUIRED: 当前账户余额不足").kind).toBe("payment_required")
  })

  it("maps common completion failures without treating them as payment errors", () => {
    expect(resolveChatError("CHAT_COMPLETION_TIMEOUT: Request timeout: chat.completion").kind).toBe("timeout")
    expect(resolveChatError("WebSocket connection failed").kind).toBe("connection_interrupted")
    expect(resolveChatError("Permission denied").kind).toBe("permission_denied")
  })

  it("directs a local model 401 to model configuration instead of OOMOL sign-in", () => {
    expect(resolveChatError("HTTP 401 invalid API key", { errorKind: "model_auth_required" })).toMatchObject({
      descriptionKey: "chatError.modelAuthRequired.description",
      kind: "model_auth_required",
      retryable: false,
      titleKey: "chatError.modelAuthRequired.title",
    })
    expect(chatErrorRecoveryKind("model_auth_required")).toBeNull()
  })

  it("explains content inspection failures without exposing the provider text as the user-facing message", () => {
    const error = resolveChatError(
      "Input data may contain inappropriate content. (request id: 2026071610124879712460311981024)",
    )

    expect(error).toMatchObject({
      kind: "content_filtered",
      severity: "warning",
      titleKey: "chatError.contentFiltered.title",
      descriptionKey: "chatError.contentFiltered.description",
      primaryActionKey: "chatError.contentFiltered.primaryAction",
      retryable: false,
    })
    expect(error.diagnostics).toContain("2026071610124879712460311981024")
  })

  it("assigns every chat error to an explicit recovery path", () => {
    expect(chatErrorRecoveryKind("payment_required")).toBe("billing")
    expect(chatErrorRecoveryKind("content_filtered")).toBe("fresh_task")
    expect(chatErrorRecoveryKind("auth_required")).toBe("reauthenticate")
    expect(chatErrorRecoveryKind("permission_denied")).toBe("reauthenticate")
    for (const kind of [
      "timeout",
      "connection_interrupted",
      "rate_limited",
      "provider_unavailable",
      "unknown",
    ] as const) {
      expect(chatErrorRecoveryKind(kind)).toBe("current_task")
    }
  })
})
