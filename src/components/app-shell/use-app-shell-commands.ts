import type { AppCommand } from "../../../electron/app-command.ts"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"

import * as React from "react"
import { toast } from "sonner"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { useAppCommandEvents, useAppCommandShortcuts } from "@/hooks/useAppCommandShortcuts"
import { useT } from "@/i18n/i18n"
import { resolveManualUpdateCheckAction, shouldStartManualUpdateCheck } from "@/lib/manual-update-check"

export function useAppShellCommands({
  appUpdate,
  onFocusComposer,
  onNewChat,
  onOpenConnections,
  onOpenSearch,
  onOpenSettings,
  onStopGeneration,
  onToggleSidebar,
}: {
  appUpdate: UseAppUpdate
  onFocusComposer: () => void
  onNewChat: () => void
  onOpenConnections: () => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  onStopGeneration: () => void
  onToggleSidebar: () => void
}): void {
  const t = useT()
  const showManualUpdateCheckResult = React.useCallback(
    (state: Parameters<typeof resolveManualUpdateCheckAction>[0]): void => {
      const action = resolveManualUpdateCheckAction(state)
      const options = { id: "manual-update-check" }
      switch (action.type) {
        case "check":
        case "checking":
          toast.loading(t("nav.updateChecking"), options)
          return
        case "available":
          toast.info(t("nav.updateAvailable", { version: action.version }), options)
          return
        case "downloading":
          toast.info(t("nav.updateDownloading", { percent: action.percent }), options)
          return
        case "downloaded":
          toast.info(t("nav.updateReady", { version: action.version }), options)
          return
        case "not-available":
          toast.success(t("nav.updateUpToDate", { version: action.version }), options)
          return
        case "error":
          toast.error(t("nav.updateCheckFailed"), options)
          return
        case "unavailable":
          toast.info(t("nav.updateDevUnavailable"), options)
      }
    },
    [t],
  )
  const handleManualUpdateCheck = React.useCallback(async (): Promise<void> => {
    if (!shouldStartManualUpdateCheck(appUpdate.state)) {
      showManualUpdateCheckResult(appUpdate.state)
      return
    }
    showManualUpdateCheckResult({
      channel: appUpdate.state?.channel ?? "stable",
      currentVersion: appUpdate.state?.currentVersion ?? globalThis.wanta?.version ?? "—",
      isPackaged: true,
      status: { status: "checking" },
    })
    showManualUpdateCheckResult(await appUpdate.check())
  }, [appUpdate, showManualUpdateCheckResult])
  const runAppCommand = React.useCallback(
    (command: AppCommand): void => {
      switch (command) {
        case APP_COMMANDS.checkForUpdates:
          void handleManualUpdateCheck()
          return
        case APP_COMMANDS.openConnections:
          onOpenConnections()
          return
        case APP_COMMANDS.focusComposer:
          onFocusComposer()
          return
        case APP_COMMANDS.newChat:
          onNewChat()
          return
        case APP_COMMANDS.openSearch:
          onOpenSearch()
          return
        case APP_COMMANDS.openSettings:
          onOpenSettings()
          return
        case APP_COMMANDS.stopGeneration:
          onStopGeneration()
          return
        case APP_COMMANDS.toggleSidebar:
          onToggleSidebar()
      }
    },
    [
      handleManualUpdateCheck,
      onFocusComposer,
      onNewChat,
      onOpenConnections,
      onOpenSearch,
      onOpenSettings,
      onStopGeneration,
      onToggleSidebar,
    ],
  )
  useAppCommandEvents(runAppCommand)
  useAppCommandShortcuts(runAppCommand)
}
