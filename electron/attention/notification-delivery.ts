import type { NotificationTestResult } from "./common.ts"

export interface NativeNotificationDelivery {
  onFailed(listener: (error: string) => void): void
  onShow(listener: () => void): void
  removeFailedListener(listener: (error: string) => void): void
  removeShowListener(listener: () => void): void
  show(): void
}

/** 把 Electron 的事件式通知投递转成可经 IPC 返回的确定结果。 */
export function deliverNotification(
  notification: NativeNotificationDelivery,
  timeoutMs: number,
): Promise<NotificationTestResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: NotificationTestResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      notification.removeShowListener(handleShow)
      notification.removeFailedListener(handleFailed)
      resolve(result)
    }
    const handleShow = (): void => finish({ outcome: "shown" })
    const handleFailed = (error: string): void => {
      finish({ error: error || "Native notification delivery failed.", outcome: "failed" })
    }
    const timeout = setTimeout(() => finish({ outcome: "timed-out" }), timeoutMs)

    notification.onShow(handleShow)
    notification.onFailed(handleFailed)
    try {
      notification.show()
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error), outcome: "failed" })
    }
  })
}
