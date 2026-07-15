import type { NativeNotificationDelivery } from "./notification-delivery.ts"

import { describe, expect, it } from "vitest"
import { submitNotification } from "./notification-delivery.ts"

function fakeNotification(outcome: "accepted" | "failed" | "throw" | "timeout"): NativeNotificationDelivery {
  let showListener: (() => void) | null = null
  let failedListener: ((error: string) => void) | null = null
  return {
    onFailed: (listener) => {
      failedListener = listener
    },
    onShow: (listener) => {
      showListener = listener
    },
    removeFailedListener: (listener) => {
      if (failedListener === listener) failedListener = null
    },
    removeShowListener: (listener) => {
      if (showListener === listener) showListener = null
    },
    show: () => {
      if (outcome === "accepted") showListener?.()
      if (outcome === "failed") failedListener?.("notifications are disabled")
      if (outcome === "throw") throw new Error("native constructor failed")
    },
  }
}

describe("submitNotification", () => {
  it("reports the native show event as accepted rather than visibly delivered", async () => {
    await expect(submitNotification(fakeNotification("accepted"), 50)).resolves.toEqual({ outcome: "accepted" })
  })

  it("returns native failures and synchronous exceptions", async () => {
    await expect(submitNotification(fakeNotification("failed"), 50)).resolves.toEqual({
      error: "notifications are disabled",
      outcome: "failed",
    })
    await expect(submitNotification(fakeNotification("throw"), 50)).resolves.toEqual({
      error: "native constructor failed",
      outcome: "failed",
    })
  })

  it("times out instead of reporting an unconfirmed notification as successful", async () => {
    await expect(submitNotification(fakeNotification("timeout"), 1)).resolves.toEqual({ outcome: "timed-out" })
  })
})
