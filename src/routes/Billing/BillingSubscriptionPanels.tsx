import type { SubscriptionPlanTag, WantaSubscriptionPlan } from "../../../electron/chat/common.ts"
import type { WantaCheckoutPreview, WantaLoadingTarget } from "./use-wanta-checkout.ts"
import type { WantaSubscriptionOverview } from "./wanta-subscription-model.ts"

import {
  CreditCardIcon,
  CheckIcon,
  GiftIcon,
  ListIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n/i18n"
import { subscriptionCheckoutUrl, subscriptionPortalUrl } from "@/lib/billing-client"
import { cn } from "@/lib/utils"

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="oo-text-caption flex gap-1.5">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="oo-text-value">{value}</div>
    </div>
  )
}

const BillingPanel = React.forwardRef<
  HTMLElement,
  { bodyClassName?: string; children: React.ReactNode; className?: string; meta?: string; title: string }
>(({ bodyClassName, children, className, meta, title }, ref) => (
  <section
    ref={ref}
    className={cn("overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background", className)}
  >
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--oo-divider)] px-3 py-2">
      <h2 className="oo-text-title truncate">{title}</h2>
      {meta ? <span className="oo-text-caption">{meta}</span> : null}
    </div>
    <div className={cn("p-3", bodyClassName)}>{children}</div>
  </section>
))
BillingPanel.displayName = "BillingPanel"

function normalizeAdditionalSeats(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export function PlanSeatOverviewPanel({
  loading,
  overview,
  seatLoading,
  workspaceLabel,
}: {
  loading: boolean
  overview: WantaSubscriptionOverview
  seatLoading: boolean
  workspaceLabel: string
}) {
  const t = useT()
  const statusVariant = overview.hasPendingPayment ? "warning" : overview.currentPlan ? "success" : "outline"
  const descriptionKey = overview.hasPendingPayment
    ? "billing.planStatus.pendingDescription"
    : !overview.currentPlan
      ? "billing.planStatus.freeDescription"
      : overview.overCapacity
        ? "billing.planStatus.overCapacityDescription"
        : "billing.planStatus.activeDescription"
  const seatValue =
    loading || seatLoading
      ? "..."
      : overview.seatCapacity === null
        ? t("billing.planStatus.members", { count: overview.usedSeats })
        : `${overview.usedSeats}/${overview.seatCapacity}`

  return (
    <BillingPanel title={t("billing.planStatus.title")} meta={workspaceLabel}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <ShieldCheckIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="oo-text-title text-foreground">
                {overview.currentPlan ? wantaPlanLabel(overview.currentPlan, t) : t("billing.wantaNoPlan")}
              </h3>
              <Badge variant={statusVariant}>
                {overview.hasPendingPayment
                  ? t("billing.wantaPaymentPending")
                  : overview.currentPlan
                    ? t("billing.wantaActive")
                    : t("billing.popover.planInactive")}
              </Badge>
            </div>
            <p className="oo-text-body mt-2 text-muted-foreground">{t(descriptionKey)}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <MiniStat icon={<UsersIcon className="size-4" />} label={t("billing.planStatus.seats")} value={seatValue} />
          <MiniStat
            icon={<PlusIcon className="size-4" />}
            label={t("billing.additionalSeats.current")}
            value={loading ? "..." : String(overview.additionalSeats)}
          />
          <MiniStat
            icon={<ShieldCheckIcon className="size-4" />}
            label={t("billing.planStatus.accountsPerApp")}
            value={loading ? "..." : String(overview.accountsPerApp)}
          />
          <MiniStat
            icon={<ListIcon className="size-4" />}
            label={t("billing.wantaSharedLinks")}
            value={overview.sharedConnectorCount === undefined ? "--" : String(overview.sharedConnectorCount)}
          />
        </div>
      </div>
    </BillingPanel>
  )
}

export const PlanComparison = React.forwardRef<
  HTMLElement,
  {
    currentPlan: WantaSubscriptionPlan | null
    disabled: boolean
    loadingPlan: WantaLoadingTarget | null
    pendingPaymentPlan: WantaSubscriptionPlan | null
    onChoosePlan: (plan: WantaSubscriptionPlan) => void
  }
>(function PlanComparison({ currentPlan, disabled, loadingPlan, pendingPaymentPlan, onChoosePlan }, ref) {
  const t = useT()
  return (
    <BillingPanel
      ref={ref}
      className="scroll-mt-3"
      title={t("billing.planComparison.title")}
      meta={t("billing.planComparison.meta")}
    >
      <div className="grid gap-3">
        <WantaPromotionNotice />
        <div className="grid gap-3 md:grid-cols-2">
          <PlanComparisonCard
            current={currentPlan === "wanta_plus"}
            description={t("billing.planComparison.plusDescription")}
            features={[
              t("billing.planComparison.planning"),
              t("billing.planComparison.sharedLinks"),
              t("billing.planComparison.orgGovernance"),
              t("billing.planComparison.plusMembers"),
              t("billing.planComparison.plusAccounts"),
            ]}
            discountPrice={t("billing.wantaPlusPlanDiscountPrice")}
            disabled={disabled}
            loading={loadingPlan === "wanta_plus"}
            originalPrice={t("billing.wantaPlusPlanOriginalPrice")}
            pendingPayment={pendingPaymentPlan === "wanta_plus"}
            plan="wanta_plus"
            title={t("billing.wantaPlusPlanTitle")}
            onChoose={onChoosePlan}
          />
          <PlanComparisonCard
            current={currentPlan === "wanta_pro"}
            description={t("billing.planComparison.proDescription")}
            features={[
              t("billing.planComparison.planning"),
              t("billing.planComparison.sharedLinks"),
              t("billing.planComparison.advancedGovernance"),
              t("billing.planComparison.proMembers"),
              t("billing.planComparison.proAccounts"),
            ]}
            discountPrice={t("billing.wantaProPlanDiscountPrice")}
            disabled={disabled}
            loading={loadingPlan === "wanta_pro"}
            originalPrice={t("billing.wantaProPlanOriginalPrice")}
            pendingPayment={pendingPaymentPlan === "wanta_pro"}
            plan="wanta_pro"
            title={t("billing.wantaProPlanTitle")}
            onChoose={onChoosePlan}
          />
        </div>
      </div>
    </BillingPanel>
  )
})

const usageSubscriptionPlans: Array<{
  descriptionKey: "billing.usageSubscription.proDescription" | "billing.usageSubscription.maxDescription"
  featureKeys: Array<
    | "billing.usageSubscription.proFeatureDiscount"
    | "billing.usageSubscription.proFeatureAllowance"
    | "billing.usageSubscription.maxFeatureDiscount"
    | "billing.usageSubscription.maxFeatureAllowance"
  >
  plan: SubscriptionPlanTag
  priceKey: "billing.usageSubscription.proPrice" | "billing.usageSubscription.maxPrice"
  titleKey: "billing.usageSubscription.proTitle" | "billing.usageSubscription.maxTitle"
}> = [
  {
    descriptionKey: "billing.usageSubscription.proDescription",
    featureKeys: ["billing.usageSubscription.proFeatureDiscount", "billing.usageSubscription.proFeatureAllowance"],
    plan: "ai_pro",
    priceKey: "billing.usageSubscription.proPrice",
    titleKey: "billing.usageSubscription.proTitle",
  },
  {
    descriptionKey: "billing.usageSubscription.maxDescription",
    featureKeys: ["billing.usageSubscription.maxFeatureDiscount", "billing.usageSubscription.maxFeatureAllowance"],
    plan: "ai_max",
    priceKey: "billing.usageSubscription.maxPrice",
    titleKey: "billing.usageSubscription.maxTitle",
  },
]

export function UsageSubscriptionPanel({
  currentPlan,
  disabled,
  openExternalCheckout,
  userId,
}: {
  currentPlan: SubscriptionPlanTag | null
  disabled: boolean
  openExternalCheckout: (url: string) => Promise<void>
  userId?: string
}) {
  const t = useT()
  const [loadingPlan, setLoadingPlan] = React.useState<SubscriptionPlanTag | null>(null)

  const handleSubscription = React.useCallback(
    async (plan: SubscriptionPlanTag) => {
      setLoadingPlan(plan)
      try {
        const url = currentPlan ? await subscriptionPortalUrl() : subscriptionCheckoutUrl(plan, userId)
        await openExternalCheckout(url)
      } catch {
        toast.error(t("billing.purchaseDialog.checkoutFailed"))
      } finally {
        setLoadingPlan(null)
      }
    },
    [currentPlan, openExternalCheckout, t, userId],
  )

  return (
    <BillingPanel title={t("billing.usageSubscription.title")} meta={t("billing.usageSubscription.meta")}>
      <div className="grid gap-3 md:grid-cols-2">
        {usageSubscriptionPlans.map((plan) => {
          const current = currentPlan === plan.plan
          const loading = loadingPlan === plan.plan
          return (
            <article key={plan.plan} className="grid gap-4 rounded-md border border-border p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="oo-text-title text-foreground">{t(plan.titleKey)}</div>
                  <p className="oo-text-body mt-1 text-muted-foreground">{t(plan.descriptionKey)}</p>
                </div>
                {current ? (
                  <Badge variant="secondary">{t("billing.subscriptions.currentSubscriptionButton")}</Badge>
                ) : null}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl leading-none font-semibold text-foreground tabular-nums">
                  {t(plan.priceKey)}
                </span>
                <span className="oo-text-body text-muted-foreground">{t("billing.subscriptions.priceUnit")}</span>
              </div>
              <div className="grid gap-2">
                {plan.featureKeys.map((featureKey) => (
                  <div key={featureKey} className="oo-text-body flex items-start gap-2 text-foreground">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--oo-success-foreground)]" />
                    <span>{t(featureKey)}</span>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant={current ? "outline" : "default"}
                disabled={disabled || loadingPlan !== null}
                onClick={() => void handleSubscription(plan.plan)}
              >
                {loading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
                {current
                  ? t("billing.usageSubscription.manage")
                  : currentPlan
                    ? t("billing.usageSubscription.change")
                    : t("billing.usageSubscription.subscribe", { plan: t(plan.titleKey) })}
              </Button>
            </article>
          )
        })}
      </div>
    </BillingPanel>
  )
}

export function WantaSubscriptionPreviewDialog({
  loading,
  preview,
  onClose,
  onConfirm,
}: {
  loading: boolean
  preview: WantaCheckoutPreview | null
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()
  const details = preview?.preview
  const targetPlan = details?.targetPlan ? wantaPlanLabel(details.targetPlan, t) : t("billing.wantaNoPlan")

  return (
    <Dialog
      open={Boolean(preview)}
      title={t("billing.wantaPreview.title")}
      description={t("billing.wantaPreview.description")}
      closeLabel={t("common.cancel")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={loading} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!details || loading} onClick={onConfirm}>
            {loading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {t("billing.wantaPreview.confirm")}
          </Button>
        </>
      }
    >
      {details ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <WantaPreviewMetric label={t("billing.wantaPreview.plan")} value={targetPlan} />
          <WantaPreviewMetric label={t("billing.wantaPreview.seats")} value={String(details.targetAdditionalSeats)} />
          <WantaPreviewMetric
            label={t("billing.wantaPreview.dueNow")}
            value={formatWantaPreviewMoney(details.amountDue, details.currency)}
          />
          <WantaPreviewMetric
            label={t("billing.wantaPreview.total")}
            value={formatWantaPreviewMoney(details.total, details.currency)}
          />
          <WantaPreviewMetric
            label={t("billing.wantaPreview.timing")}
            value={t(
              details.changeTiming === "next_cycle"
                ? "billing.wantaPreview.nextCycle"
                : "billing.wantaPreview.immediate",
            )}
          />
        </div>
      ) : null}
    </Dialog>
  )
}

function WantaPreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="oo-text-caption text-muted-foreground">{label}</div>
      <div className="oo-text-title mt-1 text-foreground">{value}</div>
    </div>
  )
}

function WantaPromotionNotice() {
  const t = useT()
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--oo-success-border)] bg-[var(--oo-success-surface)] px-4 py-3 text-foreground">
      <GiftIcon className="mt-0.5 size-4 shrink-0 text-[var(--oo-success-foreground)]" />
      <div className="min-w-0">
        <div className="oo-text-title">{t("billing.wantaPromotionTitle")}</div>
        <p className="oo-text-body mt-1 text-muted-foreground">{t("billing.wantaPromotionDescription")}</p>
      </div>
    </div>
  )
}

export function BillingManagePermissionNotice() {
  const t = useT()
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-4 py-3 text-foreground">
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--oo-warning-foreground)]" />
      <div className="min-w-0">
        <div className="oo-text-title">{t("billing.managePermission.title")}</div>
        <p className="oo-text-body mt-1 text-muted-foreground">{t("billing.managePermission.description")}</p>
      </div>
    </div>
  )
}

function PlanComparisonCard({
  current,
  description,
  disabled,
  discountPrice,
  features,
  loading,
  originalPrice,
  pendingPayment,
  plan,
  title,
  onChoose,
}: {
  current: boolean
  description: string
  disabled: boolean
  discountPrice: string
  features: string[]
  loading: boolean
  originalPrice: string
  pendingPayment: boolean
  plan: WantaSubscriptionPlan
  title: string
  onChoose: (plan: WantaSubscriptionPlan) => void
}) {
  const t = useT()
  return (
    <article className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="oo-text-title text-foreground">{title}</div>
          <p className="oo-text-body mt-1 text-muted-foreground">{description}</p>
        </div>
        {current ? <Badge variant="secondary">{t("billing.subscriptions.currentSubscriptionButton")}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-baseline">
          <span className="text-3xl leading-none font-semibold text-foreground tabular-nums">{discountPrice}</span>
          <span className="oo-text-body ml-1 text-muted-foreground">{t("billing.subscriptions.priceUnit")}</span>
        </span>
        <span className="oo-text-body text-muted-foreground tabular-nums line-through">{originalPrice}</span>
        <Badge variant="success">{t("billing.wantaPromotionBadge")}</Badge>
      </div>
      <div className="grid gap-2">
        {features.map((feature) => (
          <div key={feature} className="oo-text-body flex items-start gap-2 text-foreground">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{feature}</span>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant={current ? "outline" : "default"}
        disabled={disabled || (current && !pendingPayment) || loading}
        onClick={() => onChoose(plan)}
      >
        {loading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
        {pendingPayment
          ? t("billing.wantaContinuePayment")
          : current
            ? t("billing.subscriptions.currentSubscriptionButton")
            : t("billing.planComparison.choosePlan")}
      </Button>
    </article>
  )
}

export function AdditionalSeatsPanel({
  currentAdditionalSeats,
  disabled,
  loading,
  pendingAdditionalSeats,
  workspaceLabel,
  onUpdateSeats,
}: {
  currentAdditionalSeats: number
  disabled: boolean
  loading: boolean
  pendingAdditionalSeats: number | null
  workspaceLabel: string
  onUpdateSeats: (additionalSeats: number) => void
}) {
  const t = useT()
  const [additionalSeats, setAdditionalSeats] = React.useState(currentAdditionalSeats)

  React.useEffect(() => {
    setAdditionalSeats(pendingAdditionalSeats ?? currentAdditionalSeats)
  }, [currentAdditionalSeats, pendingAdditionalSeats])

  const unchanged = additionalSeats === currentAdditionalSeats
  const pendingTargetSelected = pendingAdditionalSeats !== null && additionalSeats === pendingAdditionalSeats
  const controlDisabled = disabled || loading
  const actionDisabled = controlDisabled || (!pendingTargetSelected && unchanged)

  return (
    <BillingPanel title={t("billing.additionalSeats.title")} meta={t("billing.additionalSeats.meta")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="grid gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <UsersIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="oo-text-title text-foreground">{t("billing.additionalSeats.cardTitle")}</h3>
              <p className="oo-text-body mt-1 text-muted-foreground">
                {t("billing.additionalSeats.description", { workspace: workspaceLabel })}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniStat
              icon={<UsersIcon className="size-4" />}
              label={t("billing.additionalSeats.current")}
              value={String(currentAdditionalSeats)}
            />
            <MiniStat
              icon={<CreditCardIcon className="size-4" />}
              label={t("billing.additionalSeats.unitPrice")}
              value={t("billing.additionalSeats.price")}
            />
          </div>
        </div>

        <div className="grid content-start gap-3 justify-self-end rounded-md border border-border p-3 max-[760px]:w-full sm:w-[17rem]">
          <div className="oo-text-label text-muted-foreground">{t("billing.additionalSeats.inputLabel")}</div>
          <div className="grid w-full grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-full"
              disabled={controlDisabled || additionalSeats <= 0}
              onClick={() => setAdditionalSeats((count) => Math.max(0, count - 1))}
            >
              <MinusIcon className="size-4" />
            </Button>
            <Input
              className="h-9 w-full text-center tabular-nums"
              disabled={controlDisabled}
              min={0}
              step={1}
              type="number"
              value={additionalSeats}
              onChange={(event) => setAdditionalSeats(normalizeAdditionalSeats(event.currentTarget.value))}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-full"
              disabled={controlDisabled}
              onClick={() => setAdditionalSeats((count) => count + 1)}
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full"
            disabled={actionDisabled}
            onClick={() => onUpdateSeats(additionalSeats)}
          >
            {loading ? <RefreshCwIcon className="size-3.5 animate-spin" /> : null}
            {pendingTargetSelected ? t("billing.wantaContinuePayment") : t("billing.wantaManageSeats")}
          </Button>
        </div>
      </div>
    </BillingPanel>
  )
}

function wantaPlanLabel(plan: WantaSubscriptionPlan, t: ReturnType<typeof useT>): string {
  return plan === "wanta_pro" ? t("billing.wantaProPlanTitle") : t("billing.wantaPlusPlanTitle")
}

function formatWantaPreviewMoney(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      currency: currency?.toUpperCase() || "USD",
      style: "currency",
    }).format(value / 100)
  } catch {
    return `$${(value / 100).toFixed(2)}`
  }
}
