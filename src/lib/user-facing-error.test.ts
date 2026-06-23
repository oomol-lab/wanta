import { describe, expect, it } from "vitest"
import { resolveUserFacingError } from "./user-facing-error.ts"

describe("resolveUserFacingError", () => {
  it("classifies auth, rate limit, and server errors", () => {
    expect(resolveUserFacingError("HTTP 401 unauthorized", { area: "auth" })).toMatchObject({
      kind: "auth_required",
      titleKey: "error.authRequired.title",
    })
    expect(resolveUserFacingError('{"status":429,"message":"too many requests"}')).toMatchObject({
      kind: "rate_limited",
      severity: "warning",
    })
    expect(resolveUserFacingError("Connector request failed with status 503", { area: "connections" })).toMatchObject({
      kind: "server_unavailable",
      descriptionKey: "error.serverUnavailable.description",
    })
  })

  it("classifies the billing session-expiry sentinel as a recoverable, billing-scoped sign-in prompt", () => {
    // billing.ts 在会话 token 缺失/401 时抛出该消息：必须归类为可恢复的 auth_required（info），
    // 且用账单专属文案（聊天不受影响），而非全局"登录已失效"，否则会误导成整个账号登出。
    expect(resolveUserFacingError("Sign in is required.", { area: "billing" })).toMatchObject({
      kind: "auth_required",
      severity: "info",
      titleKey: "error.billingSessionExpired.title",
      descriptionKey: "error.billingSessionExpired.description",
    })
    // 非 billing 作用域（如语音）仍走通用登录文案。
    expect(resolveUserFacingError("HTTP 401 unauthorized", { area: "voice" })).toMatchObject({
      kind: "auth_required",
      titleKey: "error.authRequired.title",
    })
  })

  it("maps OAuth polling outcomes without exposing English hook text", () => {
    expect(resolveUserFacingError("WANTA_OAUTH_PENDING", { area: "connections" })).toMatchObject({
      kind: "timeout",
      titleKey: "error.connections.oauthPending.title",
    })
    expect(resolveUserFacingError("WANTA_OAUTH_CANCELLED", { area: "connections" })).toMatchObject({
      kind: "cancelled",
      severity: "info",
    })
  })

  it("keeps artifact file errors scoped to file operations", () => {
    expect(resolveUserFacingError("ENOENT: no such file or directory", { area: "artifact" })).toMatchObject({
      kind: "local_file_unavailable",
    })
    expect(resolveUserFacingError("Connector returned 404 not found", { area: "connections" })).toMatchObject({
      kind: "operation_failed",
      titleKey: "error.connections.title",
    })
  })
})
