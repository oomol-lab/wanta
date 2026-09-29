import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { ConnectionDiscoveryCategory } from "./connection-route-model.ts"
import type { LucideIcon } from "lucide-react"

import {
  ArrowLeft,
  Bot,
  Cloud,
  Database,
  TrendingUp,
  Megaphone,
  MessagesSquare,
  ShoppingBag,
  SquareKanban,
} from "lucide-react"
import * as React from "react"
import { compareConnectionProvidersByRecommendation, compactConnectionService } from "./connection-provider-ranking.ts"
import {
  connectionDiscoveryCategories,
  getConnectionDiscoveryCategory,
  resolveConnectionDiscoveryCategory,
} from "./connection-route-model.ts"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const discoveryCategoryIcons: Record<ConnectionDiscoveryCategory, LucideIcon> = {
  ai: Bot,
  "cross-border-ecommerce": ShoppingBag,
  communication: MessagesSquare,
  investment: TrendingUp,
  productivity: SquareKanban,
  marketing: Megaphone,
  "data-storage": Database,
  developer: Cloud,
}

const discoveryCategoryIconClasses: Record<ConnectionDiscoveryCategory, string> = {
  ai: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  "cross-border-ecommerce": "bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]",
  communication: "bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]",
  investment: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  productivity: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  marketing: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  "data-storage": "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  developer: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
}

export function ConnectionScenarioShowcase({
  onSelect,
  providers,
}: {
  onSelect: (category: ConnectionDiscoveryCategory) => void
  providers: ConnectionProviderSummary[]
}) {
  const t = useT()
  const categoryGroups = React.useMemo(() => {
    const groups = new Map<ConnectionDiscoveryCategory, ConnectionProviderSummary[]>()
    for (const category of connectionDiscoveryCategories) {
      groups.set(category.key, [])
    }
    for (const provider of providers) {
      const category = resolveConnectionDiscoveryCategory(provider)
      if (category) groups.get(category)?.push(provider)
    }
    return groups
  }, [providers])
  const featuredProviders = React.useMemo(
    () =>
      new Map(
        connectionDiscoveryCategories.map((category) => [
          category.key,
          getFeaturedProviders(categoryGroups.get(category.key) ?? [], category.featuredServices),
        ]),
      ),
    [categoryGroups],
  )

  return (
    <section className="grid">
      <div className="grid min-w-0 grid-cols-1 gap-2 min-[720px]:grid-cols-2 xl:grid-cols-4">
        {connectionDiscoveryCategories.map((category) => {
          const Icon = discoveryCategoryIcons[category.key]
          const categoryProviders = categoryGroups.get(category.key) ?? []
          const providersToShow = featuredProviders.get(category.key) ?? []

          return (
            <button
              key={category.key}
              type="button"
              aria-label={t("connections.discovery.openCategory", { category: t(category.titleKey) })}
              onClick={() => onSelect(category.key)}
              className={cn(
                "group relative flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-3 text-left shadow-xs transition-[background-color,border-color,box-shadow,transform] outline-none hover:-translate-y-px hover:border-[var(--selection-ring)] hover:bg-[var(--oo-row-hover)] hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-0",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    discoveryCategoryIconClasses[category.key],
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="oo-text-control min-w-0 flex-1 font-semibold break-words">{t(category.titleKey)}</span>
                <span className="oo-text-micro oo-text-muted shrink-0 rounded-full bg-muted px-1.5 py-0.5 tabular-nums group-hover:bg-background">
                  {t("connections.discovery.providerCount", { count: categoryProviders.length })}
                </span>
              </span>
              <span className="oo-text-caption oo-text-muted block leading-5" title={t(category.descriptionKey)}>
                {t(category.descriptionKey)}
              </span>
              <span className="mt-auto flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="flex -space-x-1" aria-hidden="true">
                  {providersToShow.map((provider) => (
                    <ProviderIcon
                      key={provider.service}
                      iconUrl={provider.iconUrl}
                      iconSprite={provider.iconSprite}
                      iconSpritePosition={provider.iconSpritePosition}
                      displayName={provider.displayName}
                      size="showcase"
                    />
                  ))}
                </span>
                <span className="oo-text-micro min-w-0 font-medium text-muted-foreground">
                  {t("connections.discovery.explore")}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function ConnectionDiscoveryCategoryHeader({
  category,
  onBack,
  providerCount,
}: {
  category: ConnectionDiscoveryCategory
  onBack: () => void
  providerCount: number
}) {
  const t = useT()
  const definition = getConnectionDiscoveryCategory(category)
  const Icon = discoveryCategoryIcons[category]

  return (
    <section
      aria-labelledby="connection-category-heading"
      className="flex min-w-0 animate-in flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card px-2 py-1.5 duration-150 fade-in-0 slide-in-from-right-2 motion-reduce:animate-none"
    >
      <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />
        {t("connections.discovery.allCategories")}
      </Button>
      <span aria-hidden="true" className="h-5 border-l" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            discoveryCategoryIconClasses[category],
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2
            id="connection-category-heading"
            className="oo-text-control min-w-0 font-semibold break-words"
            title={t(definition.descriptionKey)}
          >
            {t(definition.titleKey)}
          </h2>
          <span className="oo-text-micro text-muted-foreground tabular-nums">
            {t("connections.discovery.categoryProviderCount", { count: providerCount })}
          </span>
        </div>
      </div>
    </section>
  )
}

function getFeaturedProviders(
  providers: ConnectionProviderSummary[],
  featuredServices: readonly string[],
): ConnectionProviderSummary[] {
  const byService = new Map(providers.map((provider) => [compactConnectionService(provider.service), provider]))
  const selected = featuredServices
    .map((service) => byService.get(compactConnectionService(service)))
    .filter((provider): provider is ConnectionProviderSummary => Boolean(provider))
  const selectedServices = new Set(selected.map((provider) => provider.service))
  const fallback = providers
    .filter((provider) => !selectedServices.has(provider.service))
    .toSorted(compareConnectionProvidersByRecommendation)

  return [...selected, ...fallback].slice(0, 4)
}
