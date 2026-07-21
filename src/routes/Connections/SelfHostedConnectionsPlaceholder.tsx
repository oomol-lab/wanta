import { PlugZap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppI18n } from "@/i18n"

export function SelfHostedConnectionsPlaceholder({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useAppI18n()

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-6">
      <section className="grid w-full max-w-2xl gap-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
            <PlugZap className="size-5" />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="oo-text-title">{t("connections.selfHosted.title")}</h1>
            </div>
            <p className="oo-text-body text-muted-foreground">{t("connections.selfHosted.description")}</p>
          </div>
        </div>

        <div>
          <Button type="button" onClick={onOpenSettings}>
            {t("connections.selfHosted.openSettings")}
          </Button>
        </div>
      </section>
    </div>
  )
}
