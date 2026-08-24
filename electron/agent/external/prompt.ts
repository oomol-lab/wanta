import type { PromptAgentInput } from "../contract/input.ts"

/**
 * The stable part of Wanta's connector contract for external agents. OpenCode
 * receives this behavior through its configured system prompt and generated
 * Link tools; ACP/native agents keep their own base prompts, so carry the
 * equivalent host-owned rules in the first session turn instead.
 *
 * This is intentionally a compact execution contract, not a second copy of a
 * provider's system prompt. Identity and credentials remain enforced by the
 * host capabilities even if an agent ignores it.
 */
export const EXTERNAL_LINK_CAPABILITY_CONTRACT = `<wanta_link_capability_contract version="1">
When the wanta_link MCP server is available, use it as the primary transport for connected SaaS work.
- Discover an unknown action with search_actions, inspect its contract with inspect_action, then execute it with call_action.
- Always inspect an action before the first call_action for that action in this session. Build params from the returned inputSchema; do not guess field names or types.
- Wanta owns workspace identity, connection selection, credentials, redaction, and authorization UI. Never replace a workspace, team, or connection to recover from an error.
- Do not reproduce raw oo connector schema/run examples from Skills while wanta_link is available. A managed OOCLI is only a compatibility fallback when no matching host tool is available.
- connector schema and connector search are identity-independent and never accept --team or --personal. connector apps and connector run are workspace-bound and must not be used to change identity.
- If a Link result reports authorization_required, connection_blocked, scope_missing, or credential_expired, stop retries for that target and let Wanta present the connection flow. Do not run oo auth login or connector login from this session.
- POLICY_DENIED means the active workspace and connection were applied, but this action or its provider resource is forbidden. Do not wait, retry, switch connection, or ask the user to reconnect; explain the action-level permission limitation.
</wanta_link_capability_contract>`

export interface ExternalAgentPromptOptions {
  /** Include the stable Link contract once when this external session has Wanta Link MCP. */
  includeLinkCapabilityContract?: boolean
}

/**
 * ACP has no portable per-turn system-prompt field, and Claude's SDK system
 * prompt is fixed when a session starts. Carry Wanta's dynamic host context in
 * a clearly delimited first text block while keeping the recorded user turn
 * unchanged. The context is host-authored and must precede the user request.
 */
export function externalAgentPromptText(
  input: Pick<PromptAgentInput, "artifactDir" | "processDir" | "system" | "text">,
  options: ExternalAgentPromptOptions = {},
): string {
  const turnPaths = [
    input.artifactDir
      ? `- User-facing deliverables must be written to this exact artifact directory: ${input.artifactDir}`
      : undefined,
    input.processDir
      ? `- Temporary scripts, raw responses, logs, and scratch files must be written to this exact process directory: ${input.processDir}`
      : undefined,
    input.artifactDir
      ? "- Do not put implementation files in the artifact directory. Wanta publishes files found there when the turn completes."
      : undefined,
  ].filter((line): line is string => Boolean(line))
  const system = [
    options.includeLinkCapabilityContract ? EXTERNAL_LINK_CAPABILITY_CONTRACT : "",
    input.system?.trim(),
    turnPaths.length > 0 ? ["Managed turn directories:", ...turnPaths].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  if (!system) {
    return input.text
  }
  return [
    "<wanta_host_context>",
    "The following context is supplied by Wanta for this turn and is authoritative for Wanta-managed capabilities.",
    system,
    "</wanta_host_context>",
    "",
    "<user_request>",
    input.text,
    "</user_request>",
  ].join("\n")
}
