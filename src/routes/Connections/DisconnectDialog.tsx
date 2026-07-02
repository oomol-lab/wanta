import type { DisconnectTarget } from "./connection-route-model.ts"

import { LoaderCircle, Unplug } from "lucide-react"
import { getConnectionAppDisplayLabel } from "./connection-route-model.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"

export function DisconnectDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: DisconnectTarget | null
  busy: boolean
  onClose: () => void
  onConfirm: (target: DisconnectTarget) => void
}) {
  const t = useT()
  if (!target) {
    return null
  }

  const { app, provider } = target
  const displayName = provider.displayName
  const appIndex = app
    ? Math.max(
        0,
        provider.apps.findIndex((item) => item.id === app.id),
      )
    : 0
  const accountTypeLabel = app ? getConnectionAppDisplayLabel(app, appIndex, t) : t("connections.connectionAccounts")

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={t("connections.confirmDisconnectTitle")}
      description={t("connections.confirmDisconnectDescription", { name: displayName })}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("connections.confirmDisconnectCancel")}
          </Button>
          <Button variant="outline" disabled={busy} className="text-destructive" onClick={() => onConfirm(target)}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Unplug className="size-4" />}
            {busy ? t("connections.disconnecting") : t("connections.disconnect")}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
        <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} />
        <div className="min-w-0">
          <div className="oo-text-label truncate">{provider.displayName}</div>
          <div className="oo-text-caption oo-text-muted truncate">{accountTypeLabel}</div>
        </div>
      </div>
    </Dialog>
  )
}
