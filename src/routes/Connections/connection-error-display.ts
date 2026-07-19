import type { UserFacingError } from "@/lib/user-facing-error"

export interface ConnectionErrorNotice {
  error: UserFacingError
  showDiagnosticsCopy: boolean
}

interface DetailErrorNoticeInput {
  actionError: UserFacingError | null
  detailError: UserFacingError | null
}

interface ListErrorNoticeInput {
  detailError?: UserFacingError | null
  summaryError: UserFacingError | null
}

export function getConnectionDetailErrorNotice({
  actionError,
  detailError,
}: DetailErrorNoticeInput): ConnectionErrorNotice | null {
  if (actionError) {
    return { error: actionError, showDiagnosticsCopy: true }
  }

  if (!detailError) {
    return null
  }

  return {
    error: connectionDetailPermissionDisplayError(detailError),
    showDiagnosticsCopy: true,
  }
}

export function getConnectionListErrorNotice({
  detailError,
  summaryError,
}: ListErrorNoticeInput): ConnectionErrorNotice | null {
  if (!summaryError) {
    return null
  }

  if (detailError && connectionErrorSignature(summaryError) === connectionErrorSignature(detailError)) {
    return null
  }

  return { error: summaryError, showDiagnosticsCopy: true }
}

export function connectionErrorSignature(error: UserFacingError): string {
  return [
    error.area,
    error.kind,
    error.severity,
    error.titleKey,
    error.descriptionKey,
    error.descriptionText ?? "",
    error.diagnostics ?? "",
  ].join("\u001f")
}

function connectionDetailPermissionDisplayError(error: UserFacingError): UserFacingError {
  if (error.kind !== "permission_denied" || error.titleKey !== "error.connections.permissionDetail.title") {
    return error
  }

  return {
    ...error,
    descriptionKey: "error.connections.permissionConfigure.team.description",
    descriptionText: undefined,
    titleKey: "error.connections.permissionConfigure.title",
  }
}
