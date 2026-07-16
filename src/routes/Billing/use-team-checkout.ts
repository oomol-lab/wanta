import type {
  TeamSubscriptionChangePayload,
  TeamSubscriptionPlan,
  TeamSubscriptionPreviewResult,
} from "../../../electron/chat/common.ts"

import * as React from "react"
import { toast } from "sonner"
import { buildTeamPlanChange } from "./team-subscription-model.ts"
import { useT } from "@/i18n/i18n"
import { previewTeamSubscription, updateTeamSubscription } from "@/lib/billing-client"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export type TeamLoadingTarget = TeamSubscriptionPlan | "checkout" | "seats"

export interface TeamCheckoutPreview {
  teamId: string
  payload: TeamSubscriptionChangePayload
  preview: TeamSubscriptionPreviewResult
}

export function useTeamCheckout({
  currentAdditionalSeats,
  openExternalCheckout,
  teamId,
  pendingAdditionalSeats,
  pendingPaymentUrl,
  pendingPlan,
  refresh,
}: {
  currentAdditionalSeats: number
  openExternalCheckout: (url: string) => Promise<void>
  teamId: string | null
  pendingAdditionalSeats: number | null
  pendingPaymentUrl: string | null
  pendingPlan: TeamSubscriptionPlan | null
  refresh: () => void
}) {
  const t = useT()
  const [loading, setLoading] = React.useState<TeamLoadingTarget | null>(null)
  const [preview, setPreview] = React.useState<TeamCheckoutPreview | null>(null)
  const requestIdRef = React.useRef(0)

  React.useEffect(() => {
    requestIdRef.current += 1
    setLoading(null)
    setPreview(null)
  }, [teamId])

  const reportFailure = React.useCallback(
    (operation: string, cause: unknown) => {
      reportRendererHandledError("billing.team", operation, cause)
      const error = cause instanceof Error && cause.message.trim() ? cause.message : "Unknown error"
      toast.error(t("billing.teamCheckoutFailed", { error }))
    },
    [t],
  )

  const openPendingPayment = React.useCallback(
    async (target: TeamLoadingTarget) => {
      if (!pendingPaymentUrl) return false
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(target)
      try {
        await openExternalCheckout(pendingPaymentUrl)
      } catch (cause) {
        if (requestIdRef.current === requestId) {
          reportFailure("Opening pending Team payment failed", cause)
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(null)
        }
      }
      return true
    },
    [openExternalCheckout, pendingPaymentUrl, reportFailure],
  )

  const loadPreview = React.useCallback(
    async (payload: TeamSubscriptionChangePayload, target: TeamLoadingTarget) => {
      if (!teamId) return
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(target)
      try {
        const nextPreview = await previewTeamSubscription(teamId, payload)
        if (requestIdRef.current === requestId) {
          setPreview({ teamId, payload, preview: nextPreview })
        }
      } catch (cause) {
        if (requestIdRef.current === requestId) {
          reportFailure("Team subscription preview failed", cause)
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(null)
        }
      }
    },
    [teamId, reportFailure],
  )

  const choosePlan = React.useCallback(
    async (plan: TeamSubscriptionPlan) => {
      if (pendingPlan === plan && (await openPendingPayment(plan))) return
      await loadPreview(buildTeamPlanChange(plan, currentAdditionalSeats), plan)
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
      const result = await updateTeamSubscription(preview.teamId, preview.payload)
      const paymentUrl = result.paymentURL?.trim()
      setPreview(null)
      refresh()
      if (paymentUrl) await openExternalCheckout(paymentUrl)
      else toast.success(t("billing.teamSubscriptionUpdated"))
    } catch (cause) {
      reportFailure("Team subscription update failed", cause)
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
