import type { AppSettings, CompletionNotificationCondition } from "../../electron/settings/common.ts"

import * as React from "react"
import { DEFAULT_APP_SETTINGS } from "../../electron/settings/common.ts"
import { useSettingsService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

export function useAppSettings(): {
  settings: AppSettings
  loading: boolean
  setCompletionNotificationCondition: (condition: CompletionNotificationCondition) => Promise<void>
  setKnowledgeBaseBetaEnabled: (enabled: boolean) => Promise<void>
  setNotificationSoundEnabled: (enabled: boolean) => Promise<void>
  setUnreadBadgeEnabled: (enabled: boolean) => Promise<void>
} {
  const service = useSettingsService()
  const [settings, setSettings] = React.useState<AppSettings>(() => ({ ...DEFAULT_APP_SETTINGS }))
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    void service
      .invoke("getSettings")
      .then(
        (next) => {
          if (active) setSettings(next)
        },
        (error: unknown) => reportRendererHandledError("settings", "load application settings failed", error),
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    const unsubscribe = service.serverEvents.on("settingsChanged", (next) => {
      if (active) setSettings(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [service])

  const setKnowledgeBaseBetaEnabled = React.useCallback(
    async (enabled: boolean) => {
      await service.invoke("setKnowledgeBaseBetaEnabled", enabled)
      setSettings((current) => ({ ...current, knowledgeBaseBetaEnabled: enabled }))
    },
    [service],
  )

  const setCompletionNotificationCondition = React.useCallback(
    async (condition: CompletionNotificationCondition) => {
      await service.invoke("setCompletionNotificationCondition", condition)
      setSettings((current) => ({ ...current, completionNotificationCondition: condition }))
    },
    [service],
  )

  const setNotificationSoundEnabled = React.useCallback(
    async (enabled: boolean) => {
      await service.invoke("setNotificationSoundEnabled", enabled)
      setSettings((current) => ({ ...current, notificationSoundEnabled: enabled }))
    },
    [service],
  )

  const setUnreadBadgeEnabled = React.useCallback(
    async (enabled: boolean) => {
      await service.invoke("setUnreadBadgeEnabled", enabled)
      setSettings((current) => ({ ...current, unreadBadgeEnabled: enabled }))
    },
    [service],
  )

  return {
    settings,
    loading,
    setCompletionNotificationCondition,
    setKnowledgeBaseBetaEnabled,
    setNotificationSoundEnabled,
    setUnreadBadgeEnabled,
  }
}
