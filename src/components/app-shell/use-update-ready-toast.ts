import type { UseAppUpdate } from "@/hooks/useAppUpdate"

import * as React from "react"
import { toast } from "sonner"
import { useT } from "@/i18n/i18n"
import { updateReadyToastDecision } from "@/lib/update-ready-toast"

const handledUpdateVersions = new Set<string>()

export function useUpdateReadyToast(update: UseAppUpdate, busy: boolean): void {
  const t = useT()
  const version = update.state?.status.status === "downloaded" ? update.state.status.version : null

  React.useEffect(() => {
    const decision = updateReadyToastDecision({
      busy,
      focused: document.visibilityState === "visible" && document.hasFocus(),
      handled: version ? handledUpdateVersions.has(version) : false,
      version,
    })
    if (!version || decision === "defer" || decision === "ignore") return

    handledUpdateVersions.add(version)
    if (decision === "suppress") return

    toast.info(t("nav.updateReady", { version }), {
      action: {
        label: t("nav.restartToUpdate"),
        onClick: () => void update.install(),
      },
      description: t("updateReadyToast.description"),
      duration: 10_000,
      id: `app-update-ready-${version}`,
    })
  }, [busy, t, update, version])
}
