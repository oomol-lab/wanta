import { TriangleAlert } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"

interface FullAccessConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function FullAccessConfirmDialog({ open, onClose, onConfirm }: FullAccessConfirmDialogProps) {
  const t = useT()
  const [acknowledged, setAcknowledged] = React.useState(false)
  const checkboxRef = React.useRef<HTMLInputElement | null>(null)
  const confirmRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    if (open) {
      setAcknowledged(false)
    }
  }, [open])

  return (
    <Dialog
      open={open}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlert className="size-5 shrink-0 text-destructive" />
          <h2 className="oo-text-dialog-title truncate">{t("chat.fullAccessDialogTitle")}</h2>
        </div>
      }
      closeLabel={t("common.close")}
      initialFocus={() => checkboxRef.current}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant="destructive"
            disabled={!acknowledged}
            className="disabled:bg-destructive/55 disabled:text-white disabled:opacity-100"
            onClick={onConfirm}
          >
            {t("chat.fullAccessDialogConfirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="oo-text-body whitespace-pre-line text-muted-foreground">{t("chat.fullAccessDialogBody")}</p>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={acknowledged}
            className="size-4 rounded border-border accent-foreground"
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span className="oo-text-label text-foreground">{t("chat.fullAccessDialogAcknowledge")}</span>
        </label>
      </div>
    </Dialog>
  )
}
