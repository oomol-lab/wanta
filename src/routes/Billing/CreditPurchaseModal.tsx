import type { RechargePrice } from "../../../electron/chat/common.ts"

import { CreditCardIcon, ExternalLinkIcon, LogInIcon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { formatCredit } from "./usage.ts"
import { useChatService } from "@/components/AppContext"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { topUpCheckoutUrl } from "@/lib/billing-client"
import { cn } from "@/lib/utils"

export interface CreditPurchaseModalProps {
  cacheScope: string
  open: boolean
  onClose: () => void
  onCheckoutOpened?: () => void
  onViewDetails?: () => void
  showViewDetails?: boolean
}

interface TopUpOption {
  amount: 5 | 20 | 100
  price: RechargePrice
  titleKey:
    | "billing.purchaseDialog.topupStarterTitle"
    | "billing.purchaseDialog.topupBoostTitle"
    | "billing.purchaseDialog.topupReserveTitle"
  descriptionKey:
    | "billing.purchaseDialog.topupStarterDescription"
    | "billing.purchaseDialog.topupBoostDescription"
    | "billing.purchaseDialog.topupReserveDescription"
}

const topUpOptions: TopUpOption[] = [
  {
    amount: 5,
    price: "5_USD",
    titleKey: "billing.purchaseDialog.topupStarterTitle",
    descriptionKey: "billing.purchaseDialog.topupStarterDescription",
  },
  {
    amount: 20,
    price: "20_USD",
    titleKey: "billing.purchaseDialog.topupBoostTitle",
    descriptionKey: "billing.purchaseDialog.topupBoostDescription",
  },
  {
    amount: 100,
    price: "100_USD",
    titleKey: "billing.purchaseDialog.topupReserveTitle",
    descriptionKey: "billing.purchaseDialog.topupReserveDescription",
  },
]

export function CreditPurchaseModal({
  cacheScope,
  onCheckoutOpened,
  onClose,
  onViewDetails,
  open,
  showViewDetails = true,
}: CreditPurchaseModalProps) {
  const t = useT()
  const { login } = useAuth()
  const chatService = useChatService()
  const overview = useBillingOverview(30, { cacheScope, enabled: open })
  const isSessionExpired = overview.error?.kind === "auth_required"
  const handleSignIn = React.useCallback(() => {
    void login().then(() => overview.refresh({ force: true }))
  }, [login, overview])
  const [topUpLoading, setTopUpLoading] = React.useState<RechargePrice | null>(null)

  const currentCredits = overview.data ? formatCredit(overview.data.balance?.total.currentCredit) : "--"

  const handleTopUp = React.useCallback(
    async (price: RechargePrice) => {
      setTopUpLoading(price)
      try {
        const url = await topUpCheckoutUrl(price)
        await chatService.invoke("openExternalUrl", { url })
        onCheckoutOpened?.()
      } catch {
        toast.error(t("billing.purchaseDialog.checkoutFailed"))
      } finally {
        setTopUpLoading(null)
      }
    },
    [chatService, onCheckoutOpened, t],
  )

  const titleKey = "billing.purchaseDialog.title"
  const descriptionKey = "billing.purchaseDialog.description"

  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeLabel={t("common.cancel")}
      className="max-w-[820px]"
      title={
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
            <CreditCardIcon className="size-4" />
          </span>
          <span>{t(titleKey)}</span>
        </span>
      }
      description={t(descriptionKey)}
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {showViewDetails && onViewDetails ? (
            <Button type="button" variant="outline" size="sm" onClick={onViewDetails}>
              <ExternalLinkIcon className="size-3.5" />
              {t("billing.purchaseDialog.viewDetails")}
            </Button>
          ) : (
            <span />
          )}
          {overview.error ? (
            isSessionExpired ? (
              <Button type="button" variant="outline" size="sm" onClick={handleSignIn}>
                <LogInIcon className="size-3.5" />
                {t("billing.signInAgain")}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => void overview.refresh({ force: true })}>
                <RefreshCwIcon className={cn("size-3.5", overview.loading && "animate-spin")} />
                {t("billing.refresh")}
              </Button>
            )
          ) : null}
        </div>
        {overview.error ? <ErrorNotice error={overview.error} compact showDiagnosticsCopy={false} /> : null}

        <div className="grid gap-3">
          <SummaryCell
            label={t("billing.purchaseDialog.currentCredits")}
            value={overview.loading && !overview.data ? "..." : currentCredits}
          />
        </div>

        <section className="grid gap-3">
          <SectionHeader
            title={t("billing.purchaseDialog.topupTitle")}
            description={t("billing.purchaseDialog.topupDescription")}
          />
          <div className="grid gap-3 md:grid-cols-3">
            {topUpOptions.map((option) => {
              const actionLoading = topUpLoading === option.price
              return (
                <article key={option.price} className="grid gap-3 rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="oo-text-title text-foreground">{t(option.titleKey)}</div>
                    <div className="text-2xl font-semibold text-foreground">${option.amount}</div>
                  </div>
                  <p className="oo-text-body min-h-10 text-muted-foreground">{t(option.descriptionKey)}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={topUpLoading !== null}
                    onClick={() => void handleTopUp(option.price)}
                  >
                    {actionLoading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                    {actionLoading
                      ? t("billing.purchaseOptions.topupLoadingButton")
                      : t("billing.purchaseOptions.topupButton")}
                  </Button>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </Dialog>
  )
}

function SectionHeader({ description, title }: { description: string; title: string }) {
  return (
    <div className="grid gap-1">
      <h2 className="oo-text-dialog-title text-foreground">{title}</h2>
      <p className="oo-text-body text-muted-foreground">{description}</p>
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <span className="oo-text-label text-muted-foreground">{label}</span>
      <strong className="oo-text-value text-foreground">{value}</strong>
    </div>
  )
}
