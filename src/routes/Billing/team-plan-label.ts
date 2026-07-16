import type { TeamSubscriptionPlan } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "../../i18n/i18n.ts"

export function teamPlanLabel(plan: TeamSubscriptionPlan, t: TranslateFn): string {
  return plan === "team_pro" ? t("billing.teamProPlanTitle") : t("billing.teamPlusPlanTitle")
}
