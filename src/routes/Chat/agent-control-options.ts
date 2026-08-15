import type { AgentKind, AgentProfile } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalogOption, ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"

import { AGENT_PROFILES, isExternalAgentKind } from "../../../electron/agent/contract/profile.ts"

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

/** Whether the selected agent's currently probed runtime can accept a new turn. */
export function agentRuntimeReadyForSubmission(
  kind: AgentKind,
  status: ExternalAgentRuntimeStatus | undefined,
): boolean {
  if (!isExternalAgentKind(kind)) return true
  return status?.kind === kind && status.binary.status === "detected" && status.login.status !== "logged_out"
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
  builtInVersion: string
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
  const rows: AgentPickerRow[] = [
    { kind: "opencode", label: labels.builtIn, selectable: true, sublabel: labels.builtInVersion },
  ]
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

export const AGENT_OPTION_DEFAULT_ROW_ID = "__default__"

export interface AgentOptionRow {
  id: string
  label: string
  description?: string
}

export interface AgentOptionRowLabels {
  defaultLabel: string
  defaultDescription: string
}

/**
 * A stored selection equal to the agent-declared default id collapses to the
 * synthetic Default row: both mean "the agent's own default", and showing them
 * as two distinct states would render duplicate menu entries.
 */
export function normalizeAgentOptionValue(
  value: string | undefined,
  defaultOptionId: string | undefined,
): string | undefined {
  return value !== undefined && value === defaultOptionId ? undefined : value
}

/**
 * Synthetic Default row first (captioned with the agent default's own label
 * when known), then every option except the declared default, which the
 * Default row already represents.
 */
export function buildAgentOptionRows(
  options: readonly ExternalAgentCatalogOption[],
  defaultOptionId: string | undefined,
  labels: AgentOptionRowLabels,
): AgentOptionRow[] {
  const defaultOptionLabel = defaultOptionId
    ? options.find((option) => option.id === defaultOptionId)?.label
    : undefined
  return [
    {
      id: AGENT_OPTION_DEFAULT_ROW_ID,
      label: labels.defaultLabel,
      description: defaultOptionLabel ?? labels.defaultDescription,
    },
    ...options
      .filter((option) => option.id !== defaultOptionId)
      .map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
  ]
}
