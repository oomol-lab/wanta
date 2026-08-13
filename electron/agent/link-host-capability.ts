import type { HostCapability, HostCapabilityContext } from "./host-capability.ts"
import type { LinkCapabilityContext, LinkCapabilityRuntime } from "./link-capability.ts"

import { z } from "zod"
import { hostCapabilityBinding } from "./host-capability.ts"
import { LinkCapability } from "./link-capability.ts"

export const LINK_CAPABILITY_ID = "link"
export const LINK_RUNTIME_BINDING = "link.runtime"

export function createLinkHostCapability(capability: LinkCapability): HostCapability {
  return {
    id: LINK_CAPABILITY_ID,
    version: "1.0.0",
    instructions:
      "Wanta owns Link workspace identity and credentials. Always inspect an action before calling it. Never use raw oo CLI when these tools are available.",
    tools: [
      {
        name: "list_apps",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        description:
          "List connected Link apps/accounts in the active Wanta workspace. Use only for connection inventory or explicit account validation, not as a health check before ordinary actions.",
        inputSchema: z.object({ service: z.string().optional() }),
        execute: async (context, input) => ({
          text: await capability.listApps(linkContext(context), optionalString(input["service"])),
        }),
      },
      {
        name: "search_actions",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          "Search the Link action catalog when private/account-specific SaaS data is needed and the exact service/action is unknown. Inspect the selected action before calling it.",
        inputSchema: z.object({ query: z.string().min(1) }),
        execute: async (context, input) => ({
          text: await capability.searchActions(linkContext(context), requiredString(input["query"])),
        }),
      },
      {
        name: "inspect_action",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          "Fetch authoritative contracts for one or more <service>.<action> ids. This is identity-independent; Wanta never applies a team selector to schema inspection. Always use before call_action.",
        inputSchema: z.object({ actions: z.array(z.string()).min(1) }),
        execute: async (context, input) => ({
          text: await capability.inspectActions(linkContext(context), input["actions"] as string[]),
        }),
      },
      {
        name: "call_action",
        // The selected provider action is dynamic, so advertise the most
        // conservative truthful hints. Wanta still validates and audits it.
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        description:
          "Execute one inspected Link action in the active Wanta workspace. Pass params as a JSON object matching inspect_action. Wanta binds identity, validates explicit connectionName, redacts output, and returns structured authorization errors.",
        inputSchema: z.object({
          service: z.string().min(1),
          action: z.string().min(1),
          params: z.record(z.string(), z.unknown()).optional(),
          connectionName: z.string().optional(),
        }),
        execute: async (context, input) => ({
          text: await capability.callAction(linkContext(context), {
            action: requiredString(input["action"]),
            connectionName: optionalString(input["connectionName"]),
            params: input["params"] as Record<string, unknown> | undefined,
            service: requiredString(input["service"]),
          }),
        }),
      },
    ],
  }
}

function linkContext(context: HostCapabilityContext): LinkCapabilityContext {
  return {
    runtime: hostCapabilityBinding<LinkCapabilityRuntime>(context, LINK_RUNTIME_BINDING),
    sessionId: context.sessionId,
    ...(context.teamName ? { teamName: context.teamName } : {}),
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a validated string input.")
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
