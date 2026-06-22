import type { UserFacingError } from "@/lib/user-facing-error"

import { describe, expect, it } from "vitest"
import {
  connectionErrorSignature,
  getConnectionDetailErrorNotice,
  getConnectionListErrorNotice,
} from "./connection-error-display.ts"

function error(overrides: Partial<UserFacingError> = {}): UserFacingError {
  return {
    area: "connections",
    kind: "permission_denied",
    severity: "destructive",
    titleKey: "error.connections.permissionConnect.title",
    descriptionKey: "error.connections.permissionDenied.description",
    diagnostics: "Connector failed: HTTP 403",
    ...overrides,
  }
}

describe("connection error display", () => {
  it("shows action errors before provider detail errors", () => {
    const actionError = error({ diagnostics: "connect 403" })
    const detailError = error({
      diagnostics: "detail 403",
      titleKey: "error.connections.permissionDetail.title",
    })

    expect(getConnectionDetailErrorNotice({ actionError, detailError })?.error).toBe(actionError)
  })

  it("falls back to provider detail errors when there is no action error", () => {
    const detailError = error({ titleKey: "error.connections.permissionDetail.title" })

    expect(getConnectionDetailErrorNotice({ actionError: null, detailError })?.error).toBe(detailError)
  })

  it("suppresses a list error when the detail pane already shows the same issue", () => {
    const summaryError = error({ titleKey: "error.connections.permissionSummary.title" })
    const detailError = { ...summaryError }

    expect(getConnectionListErrorNotice({ summaryError, detailError })).toBeNull()
  })

  it("keeps distinct list and detail errors visible", () => {
    const summaryError = error({ diagnostics: "summary 403", titleKey: "error.connections.permissionSummary.title" })
    const detailError = error({ diagnostics: "detail 403", titleKey: "error.connections.permissionDetail.title" })

    expect(getConnectionListErrorNotice({ summaryError, detailError })?.error).toBe(summaryError)
  })

  it("includes diagnostics in the dedupe signature", () => {
    expect(connectionErrorSignature(error({ diagnostics: "a" }))).not.toBe(
      connectionErrorSignature(error({ diagnostics: "b" })),
    )
  })
})
