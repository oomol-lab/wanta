import type { PromptAgentInput } from "../contract/input.ts"

/**
 * ACP has no portable per-turn system-prompt field, and Claude's SDK system
 * prompt is fixed when a session starts. Carry Wanta's dynamic host context in
 * a clearly delimited first text block while keeping the recorded user turn
 * unchanged. The context is host-authored and must precede the user request.
 */
export function externalAgentPromptText(
  input: Pick<PromptAgentInput, "artifactDir" | "processDir" | "system" | "text">,
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
