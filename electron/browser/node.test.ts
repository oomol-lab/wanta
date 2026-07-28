import { describe, expect, it } from "vitest"
import { BrowserManager } from "./node.ts"

function browserManager(enabled: boolean): BrowserManager {
  return new BrowserManager({
    downloadsDir: "downloads",
    enabled,
    screenshotDir: "browser-screenshots",
  })
}

describe("BrowserManager enablement", () => {
  it("rejects agent actions at the main-process boundary while disabled", async () => {
    const browser = browserManager(false)

    await expect(browser.execute({ action: "read", sessionId: "session" })).rejects.toThrow(
      "The integrated browser is disabled in Settings.",
    )
    await expect(browser.getState("session")).resolves.toBeNull()
  })

  it("rejects later actions after Browser is turned off", async () => {
    const browser = browserManager(true)

    await browser.setEnabled(false)

    await expect(browser.execute({ action: "read", sessionId: "session" })).rejects.toThrow(
      "The integrated browser is disabled in Settings.",
    )
  })
})
