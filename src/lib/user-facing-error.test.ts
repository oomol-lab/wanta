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

  it("maps OAuth polling outcomes without exposing English hook text", () => {
    expect(resolveUserFacingError("LUMO_OAUTH_PENDING", { area: "connections" })).toMatchObject({
      kind: "timeout",
      titleKey: "error.connections.oauthPending.title",
    })
    expect(resolveUserFacingError("LUMO_OAUTH_CANCELLED", { area: "connections" })).toMatchObject({
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
