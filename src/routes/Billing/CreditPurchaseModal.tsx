import type { RechargePrice, SubscriptionPlanTag } from "../../../electron/chat/common.ts"

import { CheckIcon, CreditCardIcon, ExternalLinkIcon, LogInIcon, RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { formatCredit } from "./usage.ts"
import { useChatService } from "@/components/AppContext"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import { subscriptionCheckoutUrl, subscriptionPortalUrl, topUpCheckoutUrl } from "@/lib/billing-client"
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

interface SubscriptionPlan {
  plan: SubscriptionPlanTag
  titleKey: "billing.subscriptions.aiProPlanTitle" | "billing.subscriptions.aiMaxPlanTitle"
  priceKey: "billing.subscriptions.aiProPlanPrice" | "billing.subscriptions.aiMaxPlanPrice"
  summaryKey: "billing.purchaseDialog.proSummary" | "billing.purchaseDialog.maxSummary"
  featureKeys: Array<
    | "billing.subscriptions.aiProPlanFeature1"
    | "billing.subscriptions.aiProPlanFeature2"
    | "billing.subscriptions.aiMaxPlanFeature1"
    | "billing.subscriptions.aiMaxPlanFeature2"
  >
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

const subscriptionPlans: SubscriptionPlan[] = [
  {
    plan: "ai_pro",
    titleKey: "billing.subscriptions.aiProPlanTitle",
    priceKey: "billing.subscriptions.aiProPlanPrice",
    summaryKey: "billing.purchaseDialog.proSummary",
    featureKeys: ["billing.subscriptions.aiProPlanFeature1", "billing.subscriptions.aiProPlanFeature2"],
  },
  {
    plan: "ai_max",
    titleKey: "billing.subscriptions.aiMaxPlanTitle",
    priceKey: "billing.subscriptions.aiMaxPlanPrice",
    summaryKey: "billing.purchaseDialog.maxSummary",
    featureKeys: ["billing.subscriptions.aiMaxPlanFeature1", "billing.subscriptions.aiMaxPlanFeature2"],
  },
]

function subscriptionPlansFromStatus(
  status: { plan: string | null; plans: string[]; platforms: Record<string, string[]> } | null,
): string[] {
  if (!status) {
    return []
  }
  return Array.from(
    new Set([
      ...status.plans,
      ...(status.plan ? [status.plan] : []),
      ...(status.platforms["stripe"] ?? []),
      ...(status.platforms["app_store"] ?? []),
    ]),
  )
}

function planLabel(plan: string | undefined, t: ReturnType<typeof useT>): string {
  if (plan === "ai_pro") {
    return t("billing.subscriptions.aiProPlanTitle")
  }
  if (plan === "ai_max") {
    return t("billing.subscriptions.aiMaxPlanTitle")
  }
  return t("billing.noSubscription")
}

export function CreditPurchaseModal({
  cacheScope,
  onCheckoutOpened,
  onClose,
  onViewDetails,
  open,
  showViewDetails = true,
}: CreditPurchaseModalProps) {
  const t = useT()
  const { login, state } = useAuth()
  const userId = state?.account?.id
  const chatService = useChatService()
  const overview = useBillingOverview(30, { cacheScope, enabled: open })
  const isSessionExpired = overview.error?.kind === "auth_required"
  const handleSignIn = React.useCallback(() => {
    void login().then(() => overview.refresh({ force: true }))
  }, [login, overview])
  const [subscriptionLoading, setSubscriptionLoading] = React.useState<SubscriptionPlanTag | null>(null)
  const [topUpLoading, setTopUpLoading] = React.useState<RechargePrice | null>(null)

  const currentCredits = overview.data ? formatCredit(overview.data.balance?.total.currentCredit) : "--"
  const currentPlans = React.useMemo(
    () => subscriptionPlansFromStatus(overview.data?.subscription ?? null),
    [overview.data?.subscription],
  )

  const handleSubscription = React.useCallback(
    async (plan: SubscriptionPlanTag, isCurrent: boolean) => {
      setSubscriptionLoading(plan)
      try {
        // 渲染层解析结账/门户 URL，再交主进程 openExternalUrl 用系统浏览器打开（主进程只校验+外开）。
        const url =
          currentPlans.length > 0 && !isCurrent ? await subscriptionPortalUrl() : subscriptionCheckoutUrl(plan, userId)
        await chatService.invoke("openExternalUrl", { url })
        onCheckoutOpened?.()
      } catch {
        toast.error(t("billing.purchaseDialog.checkoutFailed"))
      } finally {
        setSubscriptionLoading(null)
      }
    },
    [chatService, currentPlans.length, onCheckoutOpened, t, userId],
  )

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

  const currentPlan = currentPlans.find((plan) => plan === "ai_pro" || plan === "ai_max")

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
          <span>{t("billing.purchaseDialog.title")}</span>
        </span>
      }
      description={t("billing.purchaseDialog.description")}
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
        {overview.error ? <ErrorNotice error={overview.error} compact /> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryCell
            label={t("billing.purchaseDialog.currentCredits")}
            value={overview.loading && !overview.data ? "..." : currentCredits}
          />
          <SummaryCell
            label={t("billing.purchaseDialog.currentPlan")}
            value={overview.loading && !overview.data ? "..." : planLabel(currentPlan, t)}
          />
        </div>

        <section className="grid gap-3">
          <SectionHeader
            title={t("billing.purchaseDialog.subscriptionTitle")}
            description={t("billing.purchaseDialog.subscriptionDescription")}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {subscriptionPlans.map((plan) => {
              const isCurrent = currentPlans.includes(plan.plan)
              const actionLoading = subscriptionLoading === plan.plan
              return (
                <article key={plan.plan} className="grid gap-4 rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <div className="text-base font-semibold text-foreground">{t(plan.titleKey)}</div>
                      <p className="text-sm leading-5 text-muted-foreground">{t(plan.summaryKey)}</p>
                    </div>
                    {isCurrent ? (
                      <Badge variant="secondary">{t("billing.subscriptions.currentSubscriptionButton")}</Badge>
                    ) : null}
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl leading-none font-semibold tracking-normal text-foreground">
                      {t(plan.priceKey)}
                    </span>
                    <span className="text-sm text-muted-foreground">{t("billing.subscriptions.priceUnit")}</span>
                  </div>
                  <div className="grid gap-2">
                    {plan.featureKeys.map((key) => (
                      <div key={key} className="flex items-center gap-2 text-sm text-foreground">
                        <CheckIcon className="size-4 text-[var(--oo-success-foreground)]" />
                        <span>{t(key)}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    disabled={isCurrent || subscriptionLoading !== null}
                    variant={isCurrent ? "outline" : "default"}
                    onClick={() => void handleSubscription(plan.plan, isCurrent)}
                  >
                    {actionLoading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                    {isCurrent
                      ? t("billing.subscriptions.currentSubscriptionButton")
                      : currentPlans.length > 0
                        ? t("billing.subscriptions.modifySubscriptionButton")
                        : t("billing.subscriptions.subscribePlanButton", { plan: t(plan.titleKey) })}
                  </Button>
                </article>
              )
            })}
          </div>
        </section>

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
                    <div className="text-base font-semibold text-foreground">{t(option.titleKey)}</div>
                    <div className="text-2xl font-semibold text-foreground">${option.amount}</div>
                  </div>
                  <p className="min-h-10 text-sm leading-5 text-muted-foreground">{t(option.descriptionKey)}</p>
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
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm leading-5 text-muted-foreground">{description}</p>
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <strong className="text-base font-semibold text-foreground">{value}</strong>
    </div>
  )
}
