import type { ConnectionAccountPaletteItem } from "./composer-palette-items.ts"

import { LoaderCircle } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"

export interface PendingDefaultConnection {
  item: ConnectionAccountPaletteItem
  selectConnection: () => void
}

export function DefaultConnectionConfirmDialog({
  pending,
  submitting,
  confirmButtonRef,
  onClose,
  onConfirm,
}: {
  pending: PendingDefaultConnection | null
  submitting: boolean
  confirmButtonRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()

  if (!pending) {
    return null
  }

  return (
    <Dialog
      open
      title={t("chat.connectionSetDefaultDialogTitle", { name: pending.item.displayName })}
      description={t("chat.connectionSetDefaultDialogDescription", {
        account: pending.item.accountLabel ?? pending.item.title,
      })}
      closeLabel={t("common.close")}
      initialFocus={() => confirmButtonRef.current}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button ref={confirmButtonRef} type="button" aria-busy={submitting} disabled={submitting} onClick={onConfirm}>
            {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-md border bg-muted/35 px-3 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center">{pending.item.icon}</span>
        <div className="min-w-0">
          <div className="oo-text-label truncate text-foreground">{pending.item.title}</div>
          {pending.item.description ? (
            <div className="oo-text-caption truncate text-muted-foreground">{pending.item.description}</div>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
