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

export interface ExternalAgentRuntimeStatus {
  kind: ExternalAgentKind
  displayName: string
  binary: ExternalAgentBinaryProbe
  login: ExternalAgentLoginProbe
  loginHint: string
}
