import type { TranslateFn } from "@/i18n"

import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

export function teamErrorMessage(cause: unknown, t: TranslateFn): string {
  return userFacingErrorDescription(
    resolveUserFacingError(cause, {
      area: "generic",
      fallbackDescriptionKey: "teams.actionFailedDescription",
      fallbackTitleKey: "teams.actionFailedTitle",
    }),
    t,
  )
}
