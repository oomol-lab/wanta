import { ErrorNotice } from "@/components/ErrorNotice"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export function SkillErrorNotice({ className, error }: { className?: string; error: unknown }) {
  if (!error) {
    return null
  }
  return <ErrorNotice error={resolveUserFacingError(error, { area: "skills" })} compact className={className} />
}
