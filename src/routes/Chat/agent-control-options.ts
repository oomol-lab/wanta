import type { AgentKind, AgentProfile } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"

import { AGENT_PROFILES } from "../../../electron/agent/contract/profile.ts"

// Pure helpers behind the composer agent picker and capability gating. All
// behavior derives from AGENT_PROFILES declarations and probed runtime status,
// never from per-agent branches.

/** Composer capabilities implied by an agent profile. */
export interface ComposerAgentCapabilities {
  /** Wanta build/plan mode picker applies. */
  agentModesEnabled: boolean
  /** File/directory attachments are accepted. */
  attachmentsEnabled: boolean
  /** Wanta owns model routing (model and reasoning pickers visible). */
  modelRoutingEnabled: boolean
}

export function composerCapabilitiesForProfile(profile: AgentProfile): ComposerAgentCapabilities {
  return {
    agentModesEnabled: profile.inputs.modes,
    attachmentsEnabled: profile.inputs.attachments,
    modelRoutingEnabled: profile.modelSource === "wanta",
  }
}

export interface AgentPickerRow {
  kind: AgentKind
  label: string
  /** Detected binary version, when known. */
  sublabel?: string
  /** Caption line: "not detected" or a sign-in hint. */
  hint?: string
  /** Tooltip detail, e.g. a probe error message. */
  title?: string
  selectable: boolean
}

export interface AgentPickerRowLabels {
  builtIn: string
  loginRequired: (hint: string) => string
  notDetected: string
}

export function agentPickerTriggerLabel(kind: AgentKind, builtInLabel: string): string {
  return kind === "opencode" ? builtInLabel : AGENT_PROFILES[kind].displayName
}

/** Built-in agent first, then one row per probed external agent. */
export function buildAgentPickerRows(
  options: readonly ExternalAgentRuntimeStatus[],
  labels: AgentPickerRowLabels,
): AgentPickerRow[] {
  const rows: AgentPickerRow[] = [{ kind: "opencode", label: labels.builtIn, selectable: true }]
  for (const status of options) {
    const detected = status.binary.status === "detected"
    rows.push({
      kind: status.kind,
      label: status.displayName,
      ...(status.binary.status === "detected" && status.binary.version ? { sublabel: status.binary.version } : {}),
      ...(detected
        ? status.login.status === "logged_out"
          ? { hint: labels.loginRequired(status.loginHint) }
          : {}
        : { hint: labels.notDetected }),
      ...(status.binary.status === "error" ? { title: status.binary.message } : {}),
      selectable: detected,
    })
  }
  return rows
}
