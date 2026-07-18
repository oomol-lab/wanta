import { logDiagnostic } from "./diagnostics-log.ts"

export function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT")
}

export function logStoreReadFailure(scope: string, filePath: string, error: unknown): void {
  if (isMissingFileError(error)) {
    return
  }
  console.warn(`[wanta] failed to read ${scope}:`, error)
  logDiagnostic(
    "store",
    "failed to read persisted store",
    {
      error,
      path: filePath,
      scope,
    },
    "warn",
  )
}
