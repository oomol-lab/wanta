import type { NativeNotificationDelivery } from "./notification-delivery.ts"

import { describe, expect, it } from "vitest"
import { deliverNotification } from "./notification-delivery.ts"

function fakeNotification(outcome: "failed" | "shown" | "throw" | "timeout"): NativeNotificationDelivery {
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
      if (outcome === "shown") showListener?.()
      if (outcome === "failed") failedListener?.("notifications are disabled")
      if (outcome === "throw") throw new Error("native constructor failed")
    },
  }
}

describe("deliverNotification", () => {
  it("resolves only after the native show event", async () => {
    await expect(deliverNotification(fakeNotification("shown"), 50)).resolves.toEqual({ outcome: "shown" })
  })

  it("returns native failures and synchronous exceptions", async () => {
    await expect(deliverNotification(fakeNotification("failed"), 50)).resolves.toEqual({
      error: "notifications are disabled",
      outcome: "failed",
    })
    await expect(deliverNotification(fakeNotification("throw"), 50)).resolves.toEqual({
      error: "native constructor failed",
      outcome: "failed",
    })
  })

  it("times out instead of reporting an unconfirmed notification as successful", async () => {
    await expect(deliverNotification(fakeNotification("timeout"), 1)).resolves.toEqual({ outcome: "timed-out" })
  })
})
