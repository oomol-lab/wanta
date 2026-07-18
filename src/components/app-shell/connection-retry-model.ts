export interface ConnectionRetryTarget {
  service: string
  connectionName?: string
}

function normalizeConnectionName(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function connectionRetryTargetMatches(
  pending: ConnectionRetryTarget,
  completed: ConnectionRetryTarget,
): boolean {
  if (pending.service !== completed.service) {
    return false
  }
  const expectedConnectionName = normalizeConnectionName(pending.connectionName)
  return !expectedConnectionName || expectedConnectionName === normalizeConnectionName(completed.connectionName)
}
