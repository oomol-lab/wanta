import type { UseAppUpdate } from "@/hooks/useAppUpdate"

import { Download, LoaderCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

export function AppUpdateTitlebarEntry({ update }: { update: UseAppUpdate }) {
  const t = useT()
  const state = update.state

  if (!state?.isPackaged) {
    return null
  }

  switch (state.status.status) {
    case "available": {
      const label = t("nav.updateDownload")
      return (
        <Button
          type="button"
          size="sm"
          className="oo-toolbar-button max-w-40 min-w-0"
          aria-label={label}
          disabled={update.isDownloadInFlight}
          onClick={() => void update.download()}
        >
          {update.isDownloadInFlight ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <Download className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </Button>
      )
    }
    case "downloading": {
      const percent = Math.round(state.status.percent ?? 0)
      const label = t("nav.updateDownloading", { percent })
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="oo-toolbar-button max-w-40 min-w-0"
          aria-label={label}
          disabled
        >
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          <span className="truncate">{label}</span>
        </Button>
      )
    }
    case "downloaded": {
      const label = t("nav.restartToUpdate")
      return (
        <Button
          type="button"
          size="sm"
          className="oo-toolbar-button max-w-40 min-w-0"
          aria-label={label}
          disabled={update.isInstallTriggered}
          onClick={() => void update.install()}
        >
          {update.isInstallTriggered ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </Button>
      )
    }
    default:
      return null
  }
}
