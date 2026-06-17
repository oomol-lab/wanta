export interface PaymentAutoPromptState {
  autoOpenKey?: string
  balanceChecked: boolean
  hasCredits: boolean | null
  isPaymentRequired: boolean
  recovered: boolean
}

export function canAutoPromptPayment(state: PaymentAutoPromptState): boolean {
  return Boolean(
    state.isPaymentRequired &&
    !state.recovered &&
    state.balanceChecked &&
    state.hasCredits === false &&
    state.autoOpenKey,
  )
}
