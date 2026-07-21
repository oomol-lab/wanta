import type { OpenConnectorDeploymentMode } from "@/lib/openconnector-deployment"

import { CloudIcon, LaptopIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function OpenConnectorEndpointFields({
  baseUrl,
  consoleUrl,
  disabled,
  mode,
  onBaseUrlChange,
  onConsoleUrlChange,
  onModeChange,
}: {
  baseUrl: string
  consoleUrl: string
  disabled: boolean
  mode: OpenConnectorDeploymentMode
  onBaseUrlChange: (value: string) => void
  onConsoleUrlChange: (value: string) => void
  onModeChange: (mode: OpenConnectorDeploymentMode) => void
}) {
  const t = useT()

  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="oo-text-label mb-1">{t("openConnector.deploymentType")}</legend>
        <div role="radiogroup" aria-label={t("openConnector.deploymentType")} className="grid gap-2 sm:grid-cols-2">
          <DeploymentOption
            active={mode === "online"}
            description={t("openConnector.onlineDescription")}
            disabled={disabled}
            icon={<CloudIcon className="size-4" />}
            label={t("openConnector.online")}
            onClick={() => onModeChange("online")}
          />
          <DeploymentOption
            active={mode === "local"}
            description={t("openConnector.localDescription")}
            disabled={disabled}
            icon={<LaptopIcon className="size-4" />}
            label={t("openConnector.local")}
            onClick={() => onModeChange("local")}
          />
        </div>
      </fieldset>

      {mode === "online" ? (
        <label className="grid gap-1.5">
          <span className="oo-text-label">{t("openConnector.runtimeUrl")}</span>
          <Input
            value={baseUrl}
            placeholder="https://openconnector.example.com"
            disabled={disabled}
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
          <span className="oo-text-caption-compact">{t("openConnector.runtimeUrlDescription")}</span>
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="oo-text-label">{t("openConnector.apiUrl")}</span>
            <Input
              value={baseUrl}
              placeholder="http://127.0.0.1:3000"
              disabled={disabled}
              onChange={(event) => onBaseUrlChange(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="oo-text-label">{t("openConnector.consoleUrl")}</span>
            <Input
              value={consoleUrl}
              placeholder="http://127.0.0.1:5173"
              disabled={disabled}
              onChange={(event) => onConsoleUrlChange(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function DeploymentOption({
  active,
  description,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean
  description: string
  disabled: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-foreground/25 disabled:pointer-events-none disabled:opacity-60",
        active && "border-primary/45 bg-primary/[0.04]",
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground",
          active && "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="oo-text-label block text-foreground">{label}</span>
        <span className="oo-text-caption-compact mt-0.5 block leading-4">{description}</span>
      </span>
    </button>
  )
}
