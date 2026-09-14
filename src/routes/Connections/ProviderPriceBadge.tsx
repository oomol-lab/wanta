import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { ArrowDown } from "lucide-react"
import { getMarketplacePriceReduction } from "./connection-provider-pricing.ts"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/i18n/i18n"

export function ProviderPriceBadge({ provider }: { provider: ConnectionProviderSummary }) {
  const { locale, t } = useI18n()
  const reduction = getMarketplacePriceReduction(provider.service, provider.apps)
  if (reduction === undefined) return null
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(reduction / 100)
  const description = t("connections.priceAdvantage.description", { percent })

  return (
    <Badge variant="success" className="py-0" title={description}>
      <span className="sr-only">{description}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <span className="font-normal">{t("connections.priceAdvantage.comparison")}</span>
        <ArrowDown className="size-3" />
        <span className="tabular-nums">{percent}</span>
      </span>
    </Badge>
  )
}
