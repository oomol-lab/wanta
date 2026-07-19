export interface ConnectionRetryTarget {
  service: string
  connectionName?: string
}

export function discardConnectionRetriesForSession<T extends { sessionId: string }>(
  retries: Map<string, T>,
  sessionId: string,
): string[] {
  const discardedKeys: string[] = []
  for (const [key, retry] of retries) {
    if (retry.sessionId !== sessionId) {
      continue
    }
    retries.delete(key)
    discardedKeys.push(key)
  }
  return discardedKeys
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
