import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { ArrowRight, Bot, Check, DatabaseZap, MessagesSquare, ShoppingBag } from "lucide-react"
import { crossBorderEcommerceCategory, getProviderCategoryRawLabels } from "./connection-route-model.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const scenarios = [
  {
    category: crossBorderEcommerceCategory,
    descriptionKey: "connections.scenario.crossBorderDescription",
    icon: ShoppingBag,
    activeClassName: "border-[var(--warning)] bg-[color-mix(in_oklab,var(--warning)_9%,var(--card))]",
    iconClassName: "bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]",
    titleKey: "connections.scenario.crossBorderTitle",
  },
  {
    category: "AI",
    descriptionKey: "connections.scenario.aiDescription",
    icon: Bot,
    activeClassName: "border-[var(--accent-ring)] bg-[var(--accent-soft)]",
    iconClassName: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
    titleKey: "connections.scenario.aiTitle",
  },
  {
    category: "Communication",
    descriptionKey: "connections.scenario.communicationDescription",
    icon: MessagesSquare,
    activeClassName: "border-[var(--success)] bg-[color-mix(in_oklab,var(--success)_8%,var(--card))]",
    iconClassName: "bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]",
    titleKey: "connections.scenario.communicationTitle",
  },
  {
    category: "Developer Tools",
    descriptionKey: "connections.scenario.developmentDescription",
    icon: DatabaseZap,
    activeClassName: "border-violet-500/60 bg-violet-500/[0.08]",
    iconClassName: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    titleKey: "connections.scenario.developmentTitle",
  },
] as const

export function ConnectionScenarioShowcase({
  activeCategory,
  onSelect,
  providers,
}: {
  activeCategory: string | null
  onSelect: (category: string) => void
  providers: ConnectionProviderSummary[]
}) {
  const t = useT()

  return (
    <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 min-[720px]:grid-cols-2">
      {scenarios.map((scenario) => {
        const Icon = scenario.icon
        const active = activeCategory === scenario.category
        const scenarioProviders = providers.filter((provider) =>
          getProviderCategoryRawLabels(provider).includes(scenario.category),
        )

        return (
          <button
            key={scenario.category}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(scenario.category)}
            className={cn(
              "group relative flex min-h-[116px] min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-[background-color,border-color,box-shadow,transform] outline-none hover:border-[var(--selection-ring)] hover:bg-[var(--oo-row-hover)] focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px",
              active && scenario.activeClassName,
            )}
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", scenario.iconClassName)}
                >
                  <Icon className="size-4" />
                </span>
                <span className="oo-text-control min-w-0 truncate font-semibold">{t(scenario.titleKey)}</span>
              </span>
              {active ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                  <Check className="size-3" />
                  {t("connections.scenario.current")}
                </span>
              ) : (
                <ArrowRight className="oo-text-muted size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              )}
            </span>
            <span
              className="oo-text-caption oo-text-muted block min-h-5 truncate leading-5"
              title={t(scenario.descriptionKey)}
            >
              {t(scenario.descriptionKey)}
            </span>
            <span className="mt-auto flex min-w-0 items-center justify-between gap-2">
              <span className="flex -space-x-1" aria-hidden="true">
                {scenarioProviders.slice(0, 3).map((provider) => (
                  <ProviderIcon
                    key={provider.service}
                    iconUrl={provider.iconUrl}
                    displayName={provider.displayName}
                    size="showcase"
                  />
                ))}
              </span>
              <span className={cn("oo-text-micro oo-text-muted shrink-0 font-medium", active && "text-foreground")}>
                {t("connections.scenario.connectionCount", { count: scenarioProviders.length })}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
