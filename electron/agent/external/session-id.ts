import type { AgentKind, ExternalAgentKind } from "../contract/profile.ts"

import { randomUUID } from "node:crypto"
import { AGENT_PROFILES, isExternalAgentKind } from "../contract/profile.ts"

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

export function externalAgentKindForSessionId(sessionId: string): ExternalAgentKind | undefined {
  if (!sessionId.startsWith(EXTERNAL_SESSION_ID_PREFIX)) {
    return undefined
  }
  const rest = sessionId.slice(EXTERNAL_SESSION_ID_PREFIX.length)
  const separator = rest.indexOf(":")
  if (separator <= 0) {
    return undefined
  }
  const kind = rest.slice(0, separator)
  if (kind in AGENT_PROFILES && isExternalAgentKind(kind as AgentKind)) {
    return kind as ExternalAgentKind
  }
  return undefined
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * The stable per-session UUID embedded in an external session id. Adapters may
 * reuse it as their native session identity when the agent allows caller-chosen
 * ids (Claude Code does), keeping the mapping deterministic across restarts.
 * Strictly validated: session ids arrive over IPC and this value is used in
 * file paths, so anything that is not a plain UUID is rejected.
 */
export function externalSessionUuid(sessionId: string): string | undefined {
  if (externalAgentKindForSessionId(sessionId) === undefined) {
    return undefined
  }
  const lastSeparator = sessionId.lastIndexOf(":")
  const uuid = sessionId.slice(lastSeparator + 1)
  return UUID_PATTERN.test(uuid) ? uuid : undefined
}
