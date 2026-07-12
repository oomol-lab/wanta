import * as React from "react"
import { toast } from "sonner"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

export function useArtifactFileActions(): {
  openPath: (filePath: string | undefined) => void
  showInFolder: (filePath: string | undefined) => void
} {
  const t = useT()
  const chatService = useChatService()
  const openPath = React.useCallback(
    (filePath: string | undefined): void => {
      if (!filePath) return
      void chatService.invoke("openLocalPath", { path: filePath }).catch((cause: unknown) => {
        reportRendererHandledError("generatedArtifacts.openPath", "Failed to open artifact file", cause)
        toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "artifact" }), t))
      })
    },
    [chatService, t],
  )
  const showInFolder = React.useCallback(
    (filePath: string | undefined): void => {
      if (!filePath) return
      void chatService.invoke("showLocalPathInFolder", { path: filePath }).catch((cause: unknown) => {
        reportRendererHandledError("generatedArtifacts.showInFolder", "Failed to reveal artifact file", cause)
        toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "artifact" }), t))
      })
    },
    [chatService, t],
  )
  return { openPath, showInFolder }
}
