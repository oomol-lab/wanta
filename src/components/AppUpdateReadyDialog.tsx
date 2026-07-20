import type { UseAppUpdate } from "@/hooks/useAppUpdate"

import * as React from "react"
import { storageKey } from "../../electron/branding.ts"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"
import { nextUpdateReminderTime, shouldOpenUpdateReminder } from "@/lib/update-reminder"

function reminderStorageKey(version: string): string {
  return storageKey(`update-reminder-snoozed-until.${version}`)
}

function readSnoozedUntil(version: string): number | null {
  try {
    const value = Number.parseInt(localStorage.getItem(reminderStorageKey(version)) ?? "", 10)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeSnoozedUntil(version: string, value: number): void {
  try {
    localStorage.setItem(reminderStorageKey(version), String(value))
  } catch {
    // localStorage 不可用时仅本次会话关闭；标题栏入口仍然存在。
  }
}

export function AppUpdateReadyDialog({ busy, update }: { busy: boolean; update: UseAppUpdate }) {
  const t = useT()
  const version = update.state?.status.status === "downloaded" ? update.state.status.version : null
  const [open, setOpen] = React.useState(false)

  const evaluate = React.useCallback((): number | null => {
    const now = Date.now()
    const snoozedUntil = version ? readSnoozedUntil(version) : null
    const focused = document.visibilityState === "visible" && document.hasFocus()
    setOpen(shouldOpenUpdateReminder({ busy, focused, now, snoozedUntil, version }))
    return snoozedUntil && snoozedUntil > now ? snoozedUntil - now : null
  }, [busy, version])

  React.useEffect(() => {
    const remainingMs = evaluate()
    const onForeground = (): void => {
      evaluate()
    }
    document.addEventListener("visibilitychange", onForeground)
    window.addEventListener("focus", onForeground)
    const timer = remainingMs === null ? undefined : window.setTimeout(evaluate, remainingMs)
    return () => {
      document.removeEventListener("visibilitychange", onForeground)
      window.removeEventListener("focus", onForeground)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [evaluate])

  const remindLater = (): void => {
    if (version) writeSnoozedUntil(version, nextUpdateReminderTime(Date.now()))
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onClose={remindLater}
      closeLabel={t("common.close")}
      title={t("updateReadyDialog.title", { version: version ?? "" })}
      description={t("updateReadyDialog.description")}
      className="max-w-[440px]"
      footer={
        <>
          <Button type="button" variant="outline" onClick={remindLater}>
            {t("updateReadyDialog.later")}
          </Button>
          <Button type="button" disabled={update.isInstallTriggered} onClick={() => void update.install()}>
            {t("updateReadyDialog.restart")}
          </Button>
        </>
      }
    >
      <p className="oo-text-body text-muted-foreground">{t("updateReadyDialog.body")}</p>
    </Dialog>
  )
}
