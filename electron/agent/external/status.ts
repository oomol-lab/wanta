import type { ExternalAgentKind } from "../contract/profile.ts"

// Pure status vocabulary for external (BYOA) agent probing, shared with the
// renderer. The probing implementation lives in probe.ts (main process only —
// it spawns processes); this module must stay free of node/electron imports.

export type ExternalAgentBinaryProbe =
  | { status: "detected"; path: string; version?: string }
  | { status: "not_found" }
  | { status: "error"; message: string }

export type ExternalAgentLoginProbe =
  | { status: "logged_in"; account?: string }
  | { status: "logged_out" }
  | { status: "unknown" }

/** One selectable agent-native model or effort level. */
export interface ExternalAgentCatalogOption {
  id: string
  label: string
  description?: string
}

/**
 * Agent-native selection catalog: static baseline shipped by the adapter,
 * refreshed from the live agent once a session reports richer data. An empty
 * list means the agent offers no selection on that axis (UI hides the picker).
 */
export interface ExternalAgentCatalog {
  models: ExternalAgentCatalogOption[]
  efforts: ExternalAgentCatalogOption[]
  /** The agent's own current/default model id, when reported. */
  defaultModelId?: string
  defaultEffortId?: string
}

export interface ExternalAgentRuntimeStatus {
  kind: ExternalAgentKind
  displayName: string
  binary: ExternalAgentBinaryProbe
  login: ExternalAgentLoginProbe
  loginHint: string
  /** Model/effort options the adapter can currently offer. */
  catalog?: ExternalAgentCatalog
}
