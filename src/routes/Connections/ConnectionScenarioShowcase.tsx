import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { ArrowRight, Bot, MessagesSquare, ShoppingBag } from "lucide-react"
import { crossBorderEcommerceCategory, getProviderCategoryRawLabels } from "./connection-route-model.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const scenarios = [
  {
    category: crossBorderEcommerceCategory,
    descriptionKey: "connections.scenario.crossBorderDescription",
    icon: ShoppingBag,
    iconClassName: "bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]",
    titleKey: "connections.scenario.crossBorderTitle",
  },
  {
    category: "AI",
    descriptionKey: "connections.scenario.aiDescription",
    icon: Bot,
    iconClassName: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
    titleKey: "connections.scenario.aiTitle",
  },
  {
    category: "Communication",
    descriptionKey: "connections.scenario.communicationDescription",
    icon: MessagesSquare,
    iconClassName: "bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]",
    titleKey: "connections.scenario.communicationTitle",
  },
] as const

export function ConnectionScenarioShowcase({
  onSelect,
  providers,
}: {
  onSelect: (category: string) => void
  providers: ConnectionProviderSummary[]
}) {
  const t = useT()

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {scenarios.map((scenario, index) => {
        const Icon = scenario.icon
        const scenarioProviders = providers
          .filter((provider) => getProviderCategoryRawLabels(provider).includes(scenario.category))
          .slice(0, 4)

        return (
          <button
            key={scenario.category}
            type="button"
            onClick={() => onSelect(scenario.category)}
            className={cn(
              "group flex min-h-36 min-w-0 flex-col justify-between gap-5 rounded-lg border bg-card p-4 text-left transition-[background-color,border-color,box-shadow,transform] outline-none hover:border-[var(--selection-ring)] hover:bg-[var(--oo-row-hover)] focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px",
              index === 0 && "md:col-span-2",
            )}
          >
            <span className="flex min-w-0 items-start justify-between gap-4">
              <span className="flex min-w-0 items-start gap-3">
                <span
                  className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", scenario.iconClassName)}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="oo-text-control block font-semibold">{t(scenario.titleKey)}</span>
                  <span className="oo-text-caption oo-text-muted mt-1 block max-w-xl leading-5">
                    {t(scenario.descriptionKey)}
                  </span>
                </span>
              </span>
              <ArrowRight className="oo-text-muted size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="flex min-w-0 items-end justify-between gap-3">
              <span className="flex -space-x-1.5" aria-hidden="true">
                {scenarioProviders.map((provider) => (
                  <ProviderIcon
                    key={provider.service}
                    iconUrl={provider.iconUrl}
                    displayName={provider.displayName}
                    size="lg"
                  />
                ))}
              </span>
              <span className="oo-text-micro oo-text-muted font-medium group-hover:text-foreground">
                {t("connections.scenario.explore")}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
