export interface NotificationHistoryEntry {
  id: string
}

interface NotificationHistoryConfirmationOptions {
  attempts?: number
  delay?: (milliseconds: number) => Promise<void>
  intervalMs?: number
}

const defaultAttempts = 20
const defaultIntervalMs = 100

/** 等待 macOS 通知中心历史刷新，区分原生 API 接受请求与实际进入通知中心。 */
export async function waitForNotificationInHistory(
  notificationId: string,
  readHistory: () => Promise<readonly NotificationHistoryEntry[]>,
  options: NotificationHistoryConfirmationOptions = {},
): Promise<boolean> {
  const attempts = Math.max(1, options.attempts ?? defaultAttempts)
  const intervalMs = Math.max(0, options.intervalMs ?? defaultIntervalMs)
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const history = await readHistory()
    if (history.some((notification) => notification.id === notificationId)) return true
    if (attempt < attempts - 1) await delay(intervalMs)
  }

  return false
}
