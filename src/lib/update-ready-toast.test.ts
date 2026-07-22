import { describe, expect, it } from "vitest"
import { updateReadyToastDecision } from "./update-ready-toast.ts"

describe("update ready toast policy", () => {
  it("shows once when a downloaded update is ready in an idle foreground app", () => {
    const base = { busy: false, focused: true, handled: false, version: "1.2.3" }
    expect(updateReadyToastDecision(base)).toBe("show")
    expect(updateReadyToastDecision({ ...base, handled: true })).toBe("ignore")
  })

  it("defers a foreground reminder while an Agent task is running", () => {
    expect(updateReadyToastDecision({ busy: true, focused: true, handled: false, version: "1.2.3" })).toBe("defer")
  })

  it("suppresses an in-app reminder when the native background notification owns delivery", () => {
    expect(updateReadyToastDecision({ busy: false, focused: false, handled: false, version: "1.2.3" })).toBe("suppress")
  })

  it("ignores states without a downloaded version", () => {
    expect(updateReadyToastDecision({ busy: false, focused: true, handled: false, version: null })).toBe("ignore")
  })
})
