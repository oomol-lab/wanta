import { describe, expect, it } from "vitest"
import { resolveConnectionError } from "./connections-error.ts"

describe("resolveConnectionError", () => {
  it("adds operation-specific titles to connector permission errors", () => {
    expect(resolveConnectionError("Connector /v1/apps/cloudflare failed: HTTP 403", "reconnect")).toMatchObject({
      kind: "permission_denied",
      severity: "warning",
      titleKey: "error.connections.permissionReconnect.title",
      descriptionKey: "error.connections.permissionDenied.description",
    })
  })

  it("keeps OAuth polling messages specific instead of replacing them with generic action copy", () => {
    expect(resolveConnectionError("WANTA_OAUTH_PENDING", "connect")).toMatchObject({
      kind: "timeout",
      titleKey: "error.connections.oauthPending.title",
    })
  })

  it("explains OAuth client config failures instead of treating them as service outages", () => {
    expect(
      resolveConnectionError(
        "Connector /v1/apps/twitter/connect failed: oauth client config is required for twitter.",
        "connect",
      ),
    ).toMatchObject({
      kind: "validation_error",
      severity: "warning",
      titleKey: "error.connections.oauthClientConfigRequired.title",
      descriptionKey: "error.connections.oauthClientConfigRequired.description",
    })
  })

  it("uses operation titles for unclassified connector failures", () => {
    expect(resolveConnectionError("Provider cloudflare is not available", "detail")).toMatchObject({
      kind: "operation_failed",
      titleKey: "error.connections.detailFailed.title",
    })
  })
})
