import type { RechargePrice, SubscriptionPlanTag, WantaSubscriptionPlan } from "../../../electron/chat/common.ts"

import {
  CheckIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  LogInIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  UsersIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { getSubscriptionMarkers, isWantaSubscriptionPlan } from "./plans.ts"
import { formatCredit } from "./usage.ts"
import { useChatService } from "@/components/AppContext"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/useAuth"
import { useBillingOverview } from "@/hooks/useBillingOverview"
import { useT } from "@/i18n/i18n"
import {
  subscriptionCheckoutUrl,
  subscriptionPortalUrl,
  topUpCheckoutUrl,
  wantaSubscriptionCheckoutUrl,
  wantaSubscriptionPortalUrl,
} from "@/lib/billing-client"
import { cn } from "@/lib/utils"

export interface CreditPurchaseModalProps {
  billingContext?: CreditPurchaseBillingContext
  cacheScope: string
  mode?: "subscription" | "usage" | "all"
  open: boolean
  onClose: () => void
  onCheckoutOpened?: () => void
  onViewDetails?: () => void
  showViewDetails?: boolean
}

export interface CreditPurchaseBillingContext {
  canManage: boolean
  connectedProviderCount?: number
  memberCount: number
  organizationId?: string
  organizationName?: string
  workspaceLabel: string
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

interface WantaPlan {
  plan: WantaSubscriptionPlan
  titleKey: "billing.wantaPlusPlanTitle" | "billing.wantaProPlanTitle"
  summaryKey: "billing.purchaseDialog.wantaPlusSummary" | "billing.purchaseDialog.wantaProSummary"
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

const wantaPlans: WantaPlan[] = [
  {
    plan: "wanta_plus",
    titleKey: "billing.wantaPlusPlanTitle",
    summaryKey: "billing.purchaseDialog.wantaPlusSummary",
  },
  {
    plan: "wanta_pro",
    titleKey: "billing.wantaProPlanTitle",
    summaryKey: "billing.purchaseDialog.wantaProSummary",
  },
]

function planLabel(plan: string | undefined, t: ReturnType<typeof useT>): string {
  if (plan === "wanta_plus") {
    return t("billing.wantaPlusPlanTitle")
  }
  if (plan === "wanta_pro") {
    return t("billing.wantaProPlanTitle")
  }
  if (plan === "ai_pro") {
    return t("billing.subscriptions.aiProPlanTitle")
  }
  if (plan === "ai_max") {
    return t("billing.subscriptions.aiMaxPlanTitle")
  }
  return t("billing.noSubscription")
}

export function CreditPurchaseModal({
  billingContext,
  cacheScope,
  mode = "usage",
  onCheckoutOpened,
  onClose,
  onViewDetails,
  open,
  showViewDetails = true,
}: CreditPurchaseModalProps) {
  const t = useT()
  const effectiveBillingContext = React.useMemo<CreditPurchaseBillingContext>(
    () =>
      billingContext ?? {
        canManage: true,
        memberCount: 1,
        workspaceLabel: t("billing.personalWorkspace"),
      },
    [billingContext, t],
  )
  const { login, state } = useAuth()
  const userId = state?.account?.id
  const chatService = useChatService()
  const overview = useBillingOverview(30, { cacheScope, enabled: open })
  const isSessionExpired = overview.error?.kind === "auth_required"
  const handleSignIn = React.useCallback(() => {
    void login().then(() => overview.refresh({ force: true }))
  }, [login, overview])
  const [subscriptionLoading, setSubscriptionLoading] = React.useState<SubscriptionPlanTag | null>(null)
  const [wantaLoading, setWantaLoading] = React.useState<WantaSubscriptionPlan | "seats" | null>(null)
  const [topUpLoading, setTopUpLoading] = React.useState<RechargePrice | null>(null)
  const minimumBillableSeats = React.useMemo(
    () => normalizeSeats(effectiveBillingContext.memberCount),
    [effectiveBillingContext.memberCount],
  )
  const [billableSeats, setBillableSeats] = React.useState(minimumBillableSeats)
  const checkoutBillableSeats = Math.max(minimumBillableSeats, billableSeats)

  const currentCredits = overview.data ? formatCredit(overview.data.balance?.total.currentCredit) : "--"
  const currentPlans = React.useMemo(
    () => getSubscriptionMarkers(overview.data?.subscription ?? null),
    [overview.data?.subscription],
  )
  const currentWantaPlan = currentPlans.find(isWantaSubscriptionPlan)
  const hasWantaSubscription = currentPlans.some((plan) => plan.toLowerCase().startsWith("wanta"))
  const pendingWantaPaymentUrl = overview.data?.wantaPendingPayment?.paymentURL?.trim() || ""

  React.useEffect(() => {
    if (open) {
      setBillableSeats(minimumBillableSeats)
    }
  }, [minimumBillableSeats, open])

  const handleWantaSubscription = React.useCallback(
    async (plan: WantaSubscriptionPlan, isCurrent: boolean) => {
      setWantaLoading(plan)
      try {
        const url = pendingWantaPaymentUrl
          ? pendingWantaPaymentUrl
          : hasWantaSubscription && !isCurrent
            ? await wantaSubscriptionPortalUrl()
            : wantaSubscriptionCheckoutUrl({
                billableSeats: checkoutBillableSeats,
                organizationId: effectiveBillingContext.organizationId,
                plan,
              })
        await chatService.invoke("openExternalUrl", { url })
        onCheckoutOpened?.()
      } catch {
        toast.error(t("billing.purchaseDialog.checkoutFailed"))
      } finally {
        setWantaLoading(null)
      }
    },
    [
      checkoutBillableSeats,
      effectiveBillingContext.organizationId,
      chatService,
      hasWantaSubscription,
      onCheckoutOpened,
      pendingWantaPaymentUrl,
      t,
    ],
  )

  const handleWantaSeats = React.useCallback(async () => {
    setWantaLoading("seats")
    try {
      const url = pendingWantaPaymentUrl
        ? pendingWantaPaymentUrl
        : hasWantaSubscription
          ? await wantaSubscriptionPortalUrl()
          : wantaSubscriptionCheckoutUrl({
              billableSeats: checkoutBillableSeats,
              organizationId: effectiveBillingContext.organizationId,
            })
      await chatService.invoke("openExternalUrl", { url })
      onCheckoutOpened?.()
    } catch {
      toast.error(t("billing.purchaseDialog.checkoutFailed"))
    } finally {
      setWantaLoading(null)
    }
  }, [
    checkoutBillableSeats,
    effectiveBillingContext.organizationId,
    chatService,
    hasWantaSubscription,
    onCheckoutOpened,
    pendingWantaPaymentUrl,
    t,
  ])

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

  const currentPlan = currentWantaPlan ?? currentPlans.find((plan) => plan === "ai_pro" || plan === "ai_max")
  const showWantaSection = mode === "subscription" || mode === "all"
  const showUsageSections = mode === "usage" || mode === "all"
  const titleKey =
    mode === "subscription" ? "billing.purchaseDialog.subscriptionModeTitle" : "billing.purchaseDialog.title"
  const descriptionKey =
    mode === "subscription"
      ? "billing.purchaseDialog.subscriptionModeDescription"
      : "billing.purchaseDialog.description"

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

        {showWantaSection ? (
          <section className="grid gap-3">
            <SectionHeader
              title={t("billing.purchaseDialog.wantaTitle")}
              description={t("billing.purchaseDialog.wantaDescription")}
            />
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.72fr)]">
              <div className="grid gap-3 md:grid-cols-2">
                {wantaPlans.map((plan) => {
                  const isCurrent = currentWantaPlan === plan.plan
                  const actionLoading = wantaLoading === plan.plan
                  return (
                    <article key={plan.plan} className="grid gap-4 rounded-lg border border-border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <div className="oo-text-title text-foreground">{t(plan.titleKey)}</div>
                          <p className="oo-text-body text-muted-foreground">{t(plan.summaryKey)}</p>
                        </div>
                        {isCurrent ? (
                          <Badge variant="secondary">{t("billing.subscriptions.currentSubscriptionButton")}</Badge>
                        ) : null}
                      </div>
                      <div className="grid gap-2">
                        {(
                          [
                            "billing.purchaseDialog.wantaFeatureSeats",
                            "billing.purchaseDialog.wantaFeatureLinks",
                            "billing.purchaseDialog.wantaFeatureCredentials",
                          ] as const
                        ).map((key) => (
                          <div key={key} className="oo-text-body flex items-start gap-2 text-foreground">
                            <CheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--oo-success-foreground)]" />
                            <span>{t(key)}</span>
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        disabled={
                          !effectiveBillingContext.canManage ||
                          (!pendingWantaPaymentUrl && isCurrent) ||
                          wantaLoading !== null
                        }
                        variant={isCurrent ? "outline" : "default"}
                        onClick={() => void handleWantaSubscription(plan.plan, isCurrent)}
                      >
                        {actionLoading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                        {pendingWantaPaymentUrl
                          ? t("billing.wantaContinuePayment")
                          : isCurrent
                            ? t("billing.subscriptions.currentSubscriptionButton")
                            : hasWantaSubscription
                              ? t("billing.subscriptions.modifySubscriptionButton")
                              : t("billing.subscriptions.subscribePlanButton", { plan: t(plan.titleKey) })}
                      </Button>
                    </article>
                  )
                })}
              </div>

              <article className="grid gap-4 rounded-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <UsersIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="oo-text-title text-foreground">{t("billing.wantaBillableSeats")}</div>
                    <p className="oo-text-body mt-1 text-muted-foreground">
                      {t("billing.purchaseDialog.wantaSeatsDescription", {
                        workspace: effectiveBillingContext.workspaceLabel,
                      })}
                    </p>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="oo-text-label text-muted-foreground">
                    {t("billing.purchaseDialog.wantaSeatCount")}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={
                        !effectiveBillingContext.canManage ||
                        billableSeats <= minimumBillableSeats ||
                        wantaLoading !== null
                      }
                      onClick={() => setBillableSeats((count) => Math.max(minimumBillableSeats, count - 1))}
                    >
                      <MinusIcon className="size-4" />
                    </Button>
                    <Input
                      className="w-24 text-center tabular-nums"
                      disabled={!effectiveBillingContext.canManage || wantaLoading !== null}
                      min={minimumBillableSeats}
                      step={1}
                      type="number"
                      value={billableSeats}
                      onChange={(event) =>
                        setBillableSeats(normalizeSeats(event.currentTarget.value, minimumBillableSeats))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!effectiveBillingContext.canManage || wantaLoading !== null}
                      onClick={() => setBillableSeats((count) => count + 1)}
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                  </div>
                  <div className="oo-text-caption text-muted-foreground">
                    {t("billing.purchaseDialog.wantaSeatHint", { count: effectiveBillingContext.memberCount })}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!effectiveBillingContext.canManage || wantaLoading !== null}
                  onClick={() => void handleWantaSeats()}
                >
                  {wantaLoading === "seats" ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                  {pendingWantaPaymentUrl ? t("billing.wantaContinuePayment") : t("billing.wantaManageSeats")}
                </Button>
                {!effectiveBillingContext.canManage ? (
                  <p className="oo-text-caption text-muted-foreground">{t("billing.wantaManagedByCreator")}</p>
                ) : null}
              </article>
            </div>
          </section>
        ) : null}

        {showUsageSections ? (
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
                        <div className="oo-text-title text-foreground">{t(plan.titleKey)}</div>
                        <p className="oo-text-body text-muted-foreground">{t(plan.summaryKey)}</p>
                      </div>
                      {isCurrent ? (
                        <Badge variant="secondary">{t("billing.subscriptions.currentSubscriptionButton")}</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-end gap-1">
                      <span className="text-4xl leading-none font-semibold text-foreground">{t(plan.priceKey)}</span>
                      <span className="oo-text-body text-muted-foreground">{t("billing.subscriptions.priceUnit")}</span>
                    </div>
                    <div className="grid gap-2">
                      {plan.featureKeys.map((key) => (
                        <div key={key} className="oo-text-body flex items-center gap-2 text-foreground">
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
        ) : null}

        {showUsageSections ? (
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
        ) : null}
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

function normalizeSeats(value: string | number, minimum = 1): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : minimum
}
