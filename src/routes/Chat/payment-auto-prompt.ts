export interface PaymentAutoPromptState {
  autoOpenKey?: string
  balanceChecked: boolean
  canManageFunding: boolean
  hasCredits: boolean | null
  isPaymentRequired: boolean
  recovered: boolean
}

export function canAutoPromptPayment(state: PaymentAutoPromptState): boolean {
  return Boolean(
    state.isPaymentRequired &&
    state.canManageFunding &&
    !state.recovered &&
    state.balanceChecked &&
    state.hasCredits === false &&
    state.autoOpenKey,
  )
}
