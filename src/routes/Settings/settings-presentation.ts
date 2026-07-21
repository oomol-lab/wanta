import type { AuthStatus } from "../../../electron/auth/common.ts"

export function shouldShowSelfManagedRuntimeSettings(status: AuthStatus | undefined): boolean {
  return status === "unauthenticated"
}
