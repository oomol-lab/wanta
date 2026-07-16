import type { TranslateFn } from "@/i18n"

import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

export function organizationErrorMessage(cause: unknown, t: TranslateFn): string {
  return userFacingErrorDescription(
    resolveUserFacingError(cause, {
      area: "generic",
      fallbackDescriptionKey: "organizations.actionFailedDescription",
      fallbackTitleKey: "organizations.actionFailedTitle",
    }),
    t,
  )
}
