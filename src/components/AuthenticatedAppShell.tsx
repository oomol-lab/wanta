import type { UseAuth } from "@/hooks/useAuth"

import * as React from "react"
import { AppShell } from "@/components/app-shell/AppShell"
import { AppDataProvider } from "@/components/AppDataProvider"
import { legacyOperatingMode, operatingModeGateLoading, operatingProfileTarget } from "@/components/operating-profile"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useLinkRuntime } from "@/hooks/useLinkRuntime"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { useModelCatalog } from "@/routes/Chat/useModelCatalog"
import { InitialSetupRoute } from "@/routes/Login/InitialSetupRoute"

export function AuthenticatedAppShell({ auth }: { auth: UseAuth }) {
  return (
    <AppDataProvider>
      <TooltipProvider>
        <OperatingModeGate auth={auth} />
        <Toaster />
      </TooltipProvider>
    </AppDataProvider>
  )
}

function OperatingModeGate({ auth }: { auth: UseAuth }) {
  const settings = useAppSettings()
  const linkRuntime = useLinkRuntime()
  const models = useModelCatalog()
  const [completing, setCompleting] = React.useState(false)
  const migrationStarted = React.useRef(false)
  const profileSyncStarted = React.useRef(false)
  const authenticated = auth.state?.status === "authenticated"
  const operatingMode = settings.settings.operatingMode
  const hasCustomModel = Boolean(models.catalog?.customModels.length)

  React.useEffect(() => {
    if (settings.loading || linkRuntime.loading || !models.catalog || operatingMode || migrationStarted.current) {
      return
    }

    const legacyMode = legacyOperatingMode({ authenticated, hasCustomModel, linkRuntime: linkRuntime.state })
    if (!legacyMode) return

    migrationStarted.current = true
    void settings.setOperatingMode(legacyMode).catch((error: unknown) => {
      migrationStarted.current = false
      reportRendererHandledError("settings", "operating mode migration failed", error)
    })
  }, [authenticated, hasCustomModel, linkRuntime.loading, linkRuntime.state, models.catalog, operatingMode, settings])

  React.useEffect(() => {
    const target = operatingProfileTarget(authenticated, operatingMode)
    if (!target || linkRuntime.loading || profileSyncStarted.current) return
    if (operatingMode === target.mode && linkRuntime.state?.selected === target.linkRuntime) return

    profileSyncStarted.current = true
    setCompleting(true)
    void (async () => {
      if (linkRuntime.state?.selected !== target.linkRuntime) {
        await linkRuntime.selectRuntime(target.linkRuntime)
      }
      if (operatingMode !== target.mode) {
        await settings.setOperatingMode(target.mode)
      }
    })()
      .catch((error: unknown) =>
        reportRendererHandledError("settings", "operating profile synchronization failed", error),
      )
      .finally(() => {
        profileSyncStarted.current = false
        setCompleting(false)
      })
  }, [authenticated, linkRuntime, operatingMode, settings])

  const completeSelfManaged = React.useCallback(async () => {
    setCompleting(true)
    try {
      await linkRuntime.selectRuntime("openconnector")
      await settings.setOperatingMode("self-managed")
    } finally {
      setCompleting(false)
    }
  }, [linkRuntime, settings])

  if (
    operatingModeGateLoading({
      authenticated,
      linkRuntimeLoading: linkRuntime.loading,
      modelCatalogAvailable: Boolean(models.catalog),
      modelCatalogFailed: Boolean(models.catalogError),
      operatingMode,
      settingsLoading: settings.loading,
    })
  ) {
    return <div className="h-full bg-background" />
  }

  if (!operatingMode) {
    return (
      <InitialSetupRoute
        auth={auth}
        completing={completing}
        linkRuntime={linkRuntime}
        models={models}
        onCompleteSelfManaged={completeSelfManaged}
      />
    )
  }

  return <AppShell auth={auth} />
}
