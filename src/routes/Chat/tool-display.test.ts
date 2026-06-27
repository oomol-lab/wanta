import { describe, expect, it } from "vitest"
import { normalizeServiceSlug, parseToolAuthorization } from "./tool-display.ts"

describe("tool display", () => {
  it("normalizes service slugs before dropping the oo prefix", () => {
    expect(normalizeServiceSlug("OO-gmail")).toBe("gmail")
    expect(normalizeServiceSlug(" oo-slack ")).toBe("slack")
  })

  it("parses in-app authorization signals without a console URL", () => {
    expect(
      parseToolAuthorization({
        kind: "tool",
        partId: "p1",
        tool: "call_action",
        status: "completed",
        output: JSON.stringify({
          status: "authorization_required",
          service: "gmail",
          action: "list_messages",
          errorCode: "connection_required",
        }),
      }),
    ).toMatchObject({
      action: "list_messages",
      errorCode: "connection_required",
      service: "gmail",
    })
  })
})
