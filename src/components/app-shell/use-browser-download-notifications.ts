import * as React from "react"
import { toast } from "sonner"
import { useBrowserService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export function useBrowserDownloadNotifications(): void {
  const browserService = useBrowserService()
  const t = useT()

  React.useEffect(
    () =>
      browserService.serverEvents.on("downloadFinished", ({ filename, state }) => {
        if (state === "completed") {
          toast.success(t("browser.downloadCompleted", { filename }), {
            action: {
              label: t("browser.showDownloads"),
              onClick: () => {
                void browserService.invoke("openDownloadsFolder").catch((error: unknown) => {
                  toast.error(t("browser.openDownloadsFailed"))
                  reportRendererHandledError("browser", "open downloads folder failed", error)
                })
              },
            },
          })
          return
        }

        toast.error(t("browser.downloadFailed", { filename }))
      }),
    [browserService, t],
  )
}
