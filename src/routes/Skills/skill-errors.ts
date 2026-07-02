import type { TranslateFn as TFunction } from "@/i18n"

import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"

export function skillErrorMessage(cause: unknown, t: TFunction): string {
  return userFacingErrorDescription(resolveUserFacingError(cause, { area: "skills" }), t)
}
