import { PlugZap, ServerCog } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useAppI18n } from "@/i18n"

export function SelfHostedConnectionsPlaceholder() {
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
              <Badge variant="secondary">{t("connections.selfHosted.todo")}</Badge>
            </div>
            <p className="oo-text-body text-muted-foreground">{t("connections.selfHosted.description")}</p>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <ServerCog className="size-4 text-muted-foreground" />
            <h2 className="oo-text-label">{t("connections.selfHosted.requirementsTitle")}</h2>
          </div>
          <ul className="oo-text-body grid list-disc gap-1.5 pl-5 text-muted-foreground">
            <li>{t("connections.selfHosted.baseUrl")}</li>
            <li>{t("connections.selfHosted.runtimeToken")}</li>
            <li>{t("connections.selfHosted.connectionCheck")}</li>
            <li>{t("connections.selfHosted.console")}</li>
          </ul>
        </div>

        <p className="oo-text-caption text-muted-foreground">{t("connections.selfHosted.hostedHint")}</p>
      </section>
    </div>
  )
}
