import type {
  WantaSubscriptionChangePayload,
  WantaSubscriptionPlan,
  WantaSubscriptionPreviewResult,
} from "../../../electron/chat/common.ts"

import * as React from "react"
import { toast } from "sonner"
import { buildWantaPlanChange } from "./wanta-subscription-model.ts"
import { useT } from "@/i18n/i18n"
import { previewWantaSubscription, updateWantaSubscription } from "@/lib/billing-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export type WantaLoadingTarget = WantaSubscriptionPlan | "checkout" | "seats"

export interface WantaCheckoutPreview {
  payload: WantaSubscriptionChangePayload
  preview: WantaSubscriptionPreviewResult
}

export function useWantaCheckout({
  currentAdditionalSeats,
  openExternalCheckout,
  pendingAdditionalSeats,
  pendingPaymentUrl,
  pendingPlan,
  refresh,
}: {
  currentAdditionalSeats: number
  openExternalCheckout: (url: string) => Promise<void>
  pendingAdditionalSeats: number | null
  pendingPaymentUrl: string | null
  pendingPlan: WantaSubscriptionPlan | null
  refresh: () => void
}) {
  const t = useT()
  const [loading, setLoading] = React.useState<WantaLoadingTarget | null>(null)
  const [preview, setPreview] = React.useState<WantaCheckoutPreview | null>(null)

  const reportFailure = React.useCallback(
    (operation: string, cause: unknown) => {
      reportRendererHandledError("billing.wanta", operation, cause)
      const error = cause instanceof Error && cause.message.trim() ? cause.message : "Unknown error"
      toast.error(t("billing.wantaCheckoutFailed", { error }))
    },
    [t],
  )

  const openPendingPayment = React.useCallback(
    async (target: WantaLoadingTarget) => {
      if (!pendingPaymentUrl) return false
      setLoading(target)
      try {
        await openExternalCheckout(pendingPaymentUrl)
      } catch (cause) {
        reportFailure("Opening pending Wanta payment failed", cause)
      } finally {
        setLoading(null)
      }
      return true
    },
    [openExternalCheckout, pendingPaymentUrl, reportFailure],
  )

  const loadPreview = React.useCallback(
    async (payload: WantaSubscriptionChangePayload, target: WantaLoadingTarget) => {
      setLoading(target)
      try {
        setPreview({ payload, preview: await previewWantaSubscription(payload) })
      } catch (cause) {
        reportFailure("Wanta subscription preview failed", cause)
      } finally {
        setLoading(null)
      }
    },
    [reportFailure],
  )

  const choosePlan = React.useCallback(
    async (plan: WantaSubscriptionPlan) => {
      if (pendingPlan === plan && (await openPendingPayment(plan))) return
      await loadPreview(buildWantaPlanChange(plan, currentAdditionalSeats), plan)
    },
    [currentAdditionalSeats, loadPreview, openPendingPayment, pendingPlan],
  )

  const updateSeats = React.useCallback(
    async (additionalSeats: number) => {
      if (pendingAdditionalSeats === additionalSeats && (await openPendingPayment("seats"))) return
      await loadPreview({ additional_seats: additionalSeats }, "seats")
    },
    [loadPreview, openPendingPayment, pendingAdditionalSeats],
  )

  const confirm = React.useCallback(async () => {
    if (!preview) return
    setLoading("checkout")
    try {
      const result = await updateWantaSubscription(preview.payload)
      const paymentUrl = result.paymentURL?.trim()
      if (paymentUrl) await openExternalCheckout(paymentUrl)
      else {
        toast.success(t("billing.wantaSubscriptionUpdated"))
        refresh()
      }
      setPreview(null)
    } catch (cause) {
      reportFailure("Wanta subscription update failed", cause)
    } finally {
      setLoading(null)
    }
  }, [openExternalCheckout, preview, refresh, reportFailure, t])

  return {
    choosePlan,
    closePreview: () => {
      if (loading !== "checkout") setPreview(null)
    },
    confirm,
    loading,
    preview,
    updateSeats,
  }
}
