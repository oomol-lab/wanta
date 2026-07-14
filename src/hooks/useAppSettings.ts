import type { AppSettings } from "../../electron/settings/common.ts"

import * as React from "react"
import { useSettingsService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

const defaultSettings: AppSettings = {
  knowledgeBaseBetaEnabled: false,
  themeSource: "system",
}

export function useAppSettings(): {
  settings: AppSettings
  loading: boolean
  setKnowledgeBaseBetaEnabled: (enabled: boolean) => Promise<void>
} {
  const service = useSettingsService()
  const [settings, setSettings] = React.useState<AppSettings>(defaultSettings)
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

  return { settings, loading, setKnowledgeBaseBetaEnabled }
}
