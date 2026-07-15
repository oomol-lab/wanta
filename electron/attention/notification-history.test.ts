import { describe, expect, it, vi } from "vitest"
import { waitForNotificationInHistory } from "./notification-history.ts"

describe("waitForNotificationInHistory", () => {
  it("confirms a notification after the native history catches up", async () => {
    const readHistory = vi
      .fn<() => Promise<Array<{ id: string }>>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "test-notification" }])
    const delay = vi.fn(async () => undefined)

    await expect(
      waitForNotificationInHistory("test-notification", readHistory, { attempts: 3, delay, intervalMs: 25 }),
    ).resolves.toBe(true)
    expect(readHistory).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledOnce()
    expect(delay).toHaveBeenCalledWith(25)
  })

  it("returns false after the bounded history checks are exhausted", async () => {
    const readHistory = vi.fn(async () => [{ id: "another-notification" }])
    const delay = vi.fn(async () => undefined)

    await expect(waitForNotificationInHistory("test-notification", readHistory, { attempts: 2, delay })).resolves.toBe(
      false,
    )
    expect(readHistory).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledOnce()
  })

  it("does not delay when the first history read contains the notification", async () => {
    const delay = vi.fn(async () => undefined)

    await expect(
      waitForNotificationInHistory("test-notification", async () => [{ id: "test-notification" }], { delay }),
    ).resolves.toBe(true)
    expect(delay).not.toHaveBeenCalled()
  })
})
