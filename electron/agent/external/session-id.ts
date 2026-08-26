import type { ExternalAgentKind } from "../contract/profile.ts"

import { randomUUID } from "node:crypto"
import { isExternalAgentKind } from "../contract/profile.ts"

export { isAgentKind } from "../contract/profile.ts"

// External-agent sessions carry their agent kind inside the session id
// (`wanta-ext:<kind>:<uuid>`), so routing between the built-in kernel and
// external adapters is a pure, synchronous id parse — no store lookup and no
// kind field smuggled through requests. OpenCode ids never collide with the
// prefix.

const EXTERNAL_SESSION_ID_PREFIX = "wanta-ext:"

export function mintExternalSessionId(kind: ExternalAgentKind): string {
  return `${EXTERNAL_SESSION_ID_PREFIX}${kind}:${randomUUID()}`
}

export function isExternalSessionId(sessionId: string): boolean {
  return sessionId.startsWith(EXTERNAL_SESSION_ID_PREFIX)
}

export interface ExternalSessionIdentity {
  /** Stable persisted provider id. It need not be available in this app version. */
  kind: string
  uuid: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const EXTERNAL_AGENT_KIND_PATTERN = /^[a-z0-9][a-z0-9-]*$/u

/** Parse persisted identity without consulting the current adapter registry. */
export function parseExternalSessionIdentity(sessionId: string): ExternalSessionIdentity | undefined {
  if (!sessionId.startsWith(EXTERNAL_SESSION_ID_PREFIX)) {
    return undefined
  }
  const rest = sessionId.slice(EXTERNAL_SESSION_ID_PREFIX.length)
  const separator = rest.indexOf(":")
  if (separator <= 0) {
    return undefined
  }
  const kind = rest.slice(0, separator)
  const uuid = rest.slice(separator + 1)
  if (!EXTERNAL_AGENT_KIND_PATTERN.test(kind) || !UUID_PATTERN.test(uuid)) return undefined
  return { kind, uuid }
}

export function externalAgentKindForSessionId(sessionId: string): ExternalAgentKind | undefined {
  const identity = parseExternalSessionIdentity(sessionId)
  if (identity && isExternalAgentKind(identity.kind)) {
    return identity.kind
  }
  return undefined
}

/**
 * The stable per-session UUID embedded in an external session id. Adapters may
 * reuse it as their native session identity when the agent allows caller-chosen
 * ids, keeping routing deterministic across restarts.
 * Strictly validated: session ids arrive over IPC and this value is used in
 * file paths, so anything that is not a plain UUID is rejected.
 */
export function externalSessionUuid(sessionId: string): string | undefined {
  return parseExternalSessionIdentity(sessionId)?.uuid
}
